"""
IDR Backend Main Server (Version 4)
Based on FastAPI and SocketIO with async support
Single Research Agent architecture

Supports three server modes:
- normal: Standard operation
- record: Record all messages to file for later replay
- replay: Replay recorded messages (mock backend)
"""

# pyright: reportUntypedFunctionDecorator=false
import argparse
import asyncio
import os
import json
import sys
import pickle
import base64
import time
from typing import Any, Literal

import socketio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Add parent directory to Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.util import load_config
from IDR_backend.data_models.project_models import ProjectManager
from IDR_backend.agents.infoTraceAgent.infoTraceAgent import trace_info_source
from config.database import DatabaseManager


class MessageRecorder:
    """Records frontend/backend messages for replay functionality."""

    # Events to skip recording (connection/project list related)
    SKIP_EVENTS = {
        "f2b_get_project_list",
        "b2f_provide_project_list",
        "connected",
    }

    def __init__(self, record_path: str):
        self.record_path = record_path
        self.messages: list[dict[str, Any]] = []
        # Ensure directory exists
        os.makedirs(os.path.dirname(record_path), exist_ok=True)

    def record_frontend_message(self, event: str, data: Any) -> None:
        """Record a message from frontend."""
        if event in self.SKIP_EVENTS:
            return
        entry = {
            "type": "frontend",
            "event": event,
            "data": data,
            "timestamp": time.time()
        }
        self.messages.append(entry)
        self._save_to_file()
        print(f"[Recorder] Recorded frontend message: {event}")

    def record_backend_message(self, event: str, data: Any) -> None:
        """Record a message from backend."""
        if event in self.SKIP_EVENTS:
            return
        entry = {
            "type": "backend",
            "event": event,
            "data": data,
            "timestamp": time.time()
        }
        self.messages.append(entry)
        self._save_to_file()
        print(f"[Recorder] Recorded backend message: {event}")

    def _save_to_file(self) -> None:
        """Save messages to JSON file with atomic write to prevent corruption."""
        try:
            # Write to temp file first
            temp_path = self.record_path + ".tmp"
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(self.messages, f, ensure_ascii=False, indent=2, default=str)
                f.flush()
                os.fsync(f.fileno())  # Ensure data is written to disk
            # Atomic replace - if this fails, original file remains intact
            os.replace(temp_path, self.record_path)
        except Exception as e:
            print(f"[Recorder] Error saving to file: {e}")
            # Clean up temp file if it exists
            temp_path = self.record_path + ".tmp"
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass


class ReplayServer:
    """Replay server that simulates backend using recorded messages."""

    def __init__(self, record_path: str, default_interval: float, global_room_name: str):
        self.record_path = record_path
        self.default_interval = default_interval
        self.global_room_name = global_room_name
        self.messages: list[dict[str, Any]] = []
        self.current_index = 0
        self._load_messages()

        # Initialize FastAPI and SocketIO
        self.app = FastAPI(title="IDR Replay Server", version="4.0.0")
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        self.sio = socketio.AsyncServer(
            async_mode="asgi",
            cors_allowed_origins="*",
            logger=True,
            engineio_logger=False,
        )
        self.socket_app = socketio.ASGIApp(self.sio, self.app)
        self._register_routes()
        self._register_events()

    def _load_messages(self) -> None:
        """Load recorded messages from file."""
        try:
            with open(self.record_path, "r", encoding="utf-8") as f:
                self.messages = json.load(f)
            print(f"[Replay] Loaded {len(self.messages)} messages from {self.record_path}")
        except FileNotFoundError:
            print(f"[Replay] Error: Record file not found: {self.record_path}")
            self.messages = []
        except Exception as e:
            print(f"[Replay] Error loading messages: {e}")
            self.messages = []

    def _register_routes(self) -> None:
        """Register HTTP routes."""
        @self.app.get("/")
        async def root():
            return {"status": "IDR Replay Server is running", "mode": "replay"}

        @self.app.get("/health")
        async def health():
            return {"status": "healthy", "mode": "replay"}

    def _register_events(self) -> None:
        """Register SocketIO event handlers for replay mode."""
        @self.sio.event
        async def connect(sid: str, environ: dict[str, Any]) -> None:
            print(f"\n[Replay] Client {sid} connected")
            await self.sio.enter_room(sid, self.global_room_name)
            await self.sio.emit("connected", {"status": "success", "mode": "replay"}, room=sid)
            # Start replay process
            asyncio.create_task(self._process_replay())

        @self.sio.event
        async def disconnect(sid: str) -> None:
            print(f"[Replay] Client {sid} disconnected")

        # Catch-all handler for frontend messages
        @self.sio.on("*")
        async def catch_all(event: str, sid: str, data: Any = None) -> None:
            print(f"[Replay] Received frontend event: {event}")
            await self._handle_frontend_message(event, data)

    async def _handle_frontend_message(self, event: str, data: Any) -> None:
        """Handle incoming frontend message and advance replay if matching."""
        if self.current_index >= len(self.messages):
            print("[Replay] Replay completed - no more messages")
            return

        current = self.messages[self.current_index]
        if current["type"] == "frontend" and current["event"] == event:
            print(f"[Replay] Matched frontend message: {event}")
            self.current_index += 1
            # Continue processing subsequent backend messages
            await self._process_replay()

    async def _process_replay(self) -> None:
        """Process replay messages - send backend messages with delay."""
        while self.current_index < len(self.messages):
            current = self.messages[self.current_index]

            if current["type"] == "frontend":
                # Wait for matching frontend message
                print(f"[Replay] Waiting for frontend message: {current['event']}")
                break
            elif current["type"] == "backend":
                # Send backend message after delay
                await asyncio.sleep(self.default_interval)
                event = current["event"]
                data = current["data"]
                print(f"[Replay] Sending backend message: {event}")
                await self.sio.emit(event, data, room=self.global_room_name)
                self.current_index += 1
            else:
                self.current_index += 1

        if self.current_index >= len(self.messages):
            print("[Replay] Replay completed!")

    def run(self, host: str = "0.0.0.0", port: int = 5000) -> None:
        """Run the replay server."""
        print(f"\n{'=' * 60}")
        print("  IDR Replay Server")
        print(f"  Starting on {host}:{port}")
        print(f"  Record file: {self.record_path}")
        print(f"  Default interval: {self.default_interval}s")
        print(f"{'=' * 60}\n")
        uvicorn.run(self.socket_app, host=host, port=port)


class IDRServer:
    """IDR Backend Server for Version 4 - Single Research Agent"""

    def __init__(
        self,
        global_room_name: str,
        project_manager: ProjectManager,
        server_mode: Literal["normal", "record"] = "normal",
        record_path: str | None = None,
    ):
        """
        Initialize IDR Server.

        Args:
            global_room_name: Global room name for all clients
            project_manager: Project manager instance
            server_mode: "normal" or "record" mode
            record_path: Path to save recorded messages (required for record mode)
        """

        # 1. Set project manager instance and global room name.
        self.project_manager = project_manager
        self.project_manager.set_server_instance(self)
        self.GLOBAL_ROOM_NAME = global_room_name  # Global room name for all clients

        # 2. Initialize server mode and recorder
        self.server_mode = server_mode
        self.recorder: MessageRecorder | None = None
        if server_mode == "record" and record_path:
            self.recorder = MessageRecorder(record_path)
            print(f"[Server] Recording mode enabled, saving to: {record_path}")

        # 3. Initialize user and database manager.
        self.user_name = "User"
        self.db_manager = self.project_manager.db_manager
        self.user_id = self.db_manager.create_user(self.user_name)
        
        # 4. Initialize FastAPI application.
        self.app = FastAPI(title="IDR Backend API", version="4.0.0")

        # 5. Configure CORS.
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # 6. Initialize SocketIO.
        self.sio = socketio.AsyncServer(
            async_mode="asgi",
            cors_allowed_origins="*",
            logger=True,
            engineio_logger=False,
        )

        # 7. Integrate SocketIO with FastAPI.
        self.socket_app = socketio.ASGIApp(self.sio, self.app)

        # 8. Register routes and events.
        self._register_http_routes()
        self._register_socketio_events()

    async def _emit_with_record(self, event: str, data: Any, room: str) -> None:
        """Emit a message and record it if in record mode."""
        if self.recorder:
            self.recorder.record_backend_message(event, data)
        await self.sio.emit(event, data, room=room)

    def _register_http_routes(self):
        """Register HTTP routes"""

        @self.app.get("/")
        async def root():
            return {"status": "IDR Backend Server v4.0 is running"}

        @self.app.get("/health")
        async def health():
            return {"status": "healthy"}

    async def _emit_project_list(self) -> None:
        """Fetch and emit the project list to the global room."""
        project_list = self.db_manager.list_titles(self.user_id)
        if not project_list:
            await self._emit_with_record(
                "error",
                {"message": "Failed to get project list"},
                room=self.GLOBAL_ROOM_NAME,
            )
            return

        await self._emit_with_record(
            "b2f_provide_project_list",
            project_list,
            room=self.GLOBAL_ROOM_NAME,
        )

    def _register_socketio_events(self):
        """Register SocketIO event handlers"""

        @self.sio.event
        async def connect(sid: str, environ: dict[str, Any]) -> None:
            """Handle client connection"""
            print(f"\n[SocketIO] Client {sid} connected")
            # Join global room automatically
            await self.sio.enter_room(sid, self.GLOBAL_ROOM_NAME)
            print(f"[SocketIO] Client {sid} joined global room")
            await self._emit_with_record("connected", {"status": "success"}, room=sid)

        @self.sio.event
        async def disconnect(sid: str) -> None:
            """Handle client disconnection"""
            print(f"[SocketIO] Client {sid} disconnected")

        @self.sio.event
        async def f2b_start_research(sid: str, data: dict[str, Any]) -> None:
            """
            Start a new research project.
            Expected data: {"research_goal": str, "request_key": str}
            """
            print(f"\n[SocketIO] f2b_start_research from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_start_research", data)

            # 1. Parse Input
            if not (research_goal := data.get("research_goal")):
                await self._emit_with_record(
                    "error",
                    {"message": "research_goal is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return
            request_key: str | None = data.get("request_key")

            # 2. Create new project and send project ID back to frontend
            project_id = self.project_manager.create_project(research_goal)
            print(f"[Server] Created project {project_id} with initial research goal: {research_goal}")
            await self._emit_with_record(
                "b2f_start_research",
                {"project_id": project_id, "request_key": request_key},
                room=self.GLOBAL_ROOM_NAME,
            )
            await self.project_manager.send_project_update(project_id)

            # 3. Create and run root agent instance in background
            root_agent_id = self.project_manager.get_root_agent_id(project_id)
            if not root_agent_id:
                print(f"[Server] Error: Root agent not found for project {project_id}")
                return

            root_agent_instance = self.project_manager.get_agent_instance(project_id, root_agent_id)
            if not root_agent_instance:
                print(f"[Server] Error: Root agent instance not found for project {project_id}")
                return

            print(f"\n[Server] Starting root agent for project {project_id}")
            asyncio.create_task(root_agent_instance.run(user_message=research_goal, reference_list=[]))

        @self.sio.event
        async def f2b_request_update(sid: str, data: dict[str, Any]) -> None:
            """
            Request update for a project (used for reconnection).
            Expected data: {"project_id": str}
            """
            print(f"\n[SocketIO] f2b_request_update from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_request_update", data)

            project_id = data.get("project_id")
            if not project_id:
                await self._emit_with_record(
                    "error",
                    {"message": "project_id is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            # Verify project exists
            project = self.project_manager.get_project(project_id)
            if not project:
                await self._emit_with_record(
                    "error",
                    {"message": "Project not found"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            print(f"[Server] Client {sid} requested update for project {project_id}")

            # Send current project state (will go to global room)
            await self.project_manager.send_project_update(project_id)

        @self.sio.event
        async def f2b_interrupt_agent(sid: str, data: dict[str, Any]) -> None:
            """
            Interrupt an agent's execution.
            Expected data: {"project_id": str, "agent_id": str}
            """
            print(f"\n[SocketIO] f2b_interrupt_agent from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_interrupt_agent", data)

            project_id = data.get("project_id")

            if not project_id:
                await self._emit_with_record(
                    "error",
                    {"message": "project_id is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return
            # Set agent's interrupted status in data model
            agent_id = self.project_manager.get_root_agent_id(project_id)
            self.project_manager.set_agent_interrupted(project_id, agent_id, True)
            print(f"[Server] Interrupted agent {agent_id} in project {project_id}")

            await self.project_manager.send_project_update(project_id)

        @self.sio.event
        async def f2b_send_message_to_agent(sid: str, data: dict[str, Any]) -> None:
            """
            Send a message to an agent and continue its execution.
            Expected data: {"project_id": str, "message": str, "reference_list": list}
            reference_list format: [{"card_id": str, "selected_content": str | None}, ...]
            """
            print(f"\n[SocketIO] f2b_send_message_to_agent from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_send_message_to_agent", data)

            project_id = data.get("project_id")
            if not project_id:
                await self._emit_with_record(
                    "error",
                    {"message": "project_id is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return
            # Update project last active time
            self.db_manager.touch_project(project_id, self.user_id)
            agent_id = self.project_manager.get_root_agent_id(
                project_id
            )  # currently only support single root agent, so we can only send message to root agent
            message = data.get("message")
            reference_list = data.get("reference_list", [])

            # Continue agent execution
            if agent_id and message:
                asyncio.create_task(self.continue_agent(project_id, agent_id, message, reference_list))
            await self._emit_project_list()

        @self.sio.event
        async def f2b_get_project_list(sid: str, data: dict[str, Any] | None = None) -> None:
            """Get the list of projects for the current user."""
            print(f"\n[SocketIO] f2b_get_project_list from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_get_project_list", data)
            await self._emit_project_list()

        @self.sio.event
        async def f2b_export_project(sid: str, data: dict[str, Any]) -> None:
            """Export a project (chat session)"""
            print(f"\n[SocketIO] f2b_export_project from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_export_project", data)

            project_id = data.get("project_id")
            if not project_id:
                await self._emit_with_record(
                    "error",
                    {"message": "project_id is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            # Verify project exists
            project = self.project_manager.get_project(project_id)
            if not project:
                await self._emit_with_record(
                    "error",
                    {"message": "Project not found"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            print(f"[Server] Client {sid} requested export for project {project_id}")

            export_data = self.db_manager.export_project(project_id, self.user_id)
            if not export_data:
                await self._emit_with_record(
                    "error",
                    {"message": "Failed to export project"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return
            
            try:
                pickle_bytes = pickle.dumps(export_data)
                
                b64_str = base64.b64encode(pickle_bytes).decode('utf-8')
                
                payload = {
                    "project_id": project_id,
                    "filename": f"project_{project_id}.pkl", 
                    "data": b64_str, 
                    "type": "pickle" 
                }
                
                await self._emit_with_record(
                    "b2f_export_project", 
                    payload,
                    room=self.GLOBAL_ROOM_NAME,
                )
                print(f"[Server] Successfully sent pickle data for project {project_id}")

            except Exception as e:
                print(f"[Server] Error pickling data: {e}")
                await self._emit_with_record(
                    "error",
                    {"message": "Internal server error during export"},
                    room=self.GLOBAL_ROOM_NAME,
                )

            # # 3. Send export data to client.
            # payload = {
            #     "project_id": project_id,
            #     "filename": f"project_{project_id}.json",
            #     "data": export_data,
            # }
            # await self.sio.emit(
            #     "b2f_export_project",
            #     payload,
            #     room=self.GLOBAL_ROOM_NAME,
            # )

        @self.sio.event
        async def f2b_delete_project(sid: str, data: dict[str, Any]) -> None:
            """Delete a project (chat session)"""
            print(f"\n[SocketIO] f2b_delete_project from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_delete_project", data)

            project_id = data.get("project_id")
            if not project_id:
                await self._emit_with_record(
                    "error",
                    {"message": "project_id is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return
            self.db_manager.delete_project(project_id, self.user_id)
            # Send updated project list to clients after deletion
            project_list = self.db_manager.list_titles(self.user_id)
            await self._emit_with_record(
                "b2f_provide_project_list",
                project_list,
                room=self.GLOBAL_ROOM_NAME,
            )

        @self.sio.event
        async def f2b_import_json_project(sid: str, data: Any) -> None:
            """Import a project (chat session)"""
            print(f"\n[SocketIO] f2b_import_json_project from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_import_json_project", data)

            try:
                # Only accept direct object payload
                payload = data if isinstance(data, dict) else None
                if payload is None:
                    await self._emit_with_record(
                        "error",
                        {"message": "Invalid import payload: require direct object"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                # Validate required fields (based on export format)
                project_id_in = payload.get("project_id")
                research_goal = payload.get("research_goal")
                root_agent_id_raw = payload.get("root_agent_id")
                created_at = payload.get("created_at")
                agent_counter_raw = payload.get("agent_counter")
                agent_dict_raw = payload.get("agent_dict")

                # Normalize types: allow str|int for ids and numeric string for counter
                root_agent_id = str(root_agent_id_raw) if isinstance(root_agent_id_raw, (str, int)) else None
                if isinstance(agent_counter_raw, int):
                    agent_counter = agent_counter_raw
                elif isinstance(agent_counter_raw, str) and agent_counter_raw.isdigit():
                    agent_counter = int(agent_counter_raw)
                else:
                    agent_counter = None

                # Require agent_dict to be an object, serialize to JSON string
                if isinstance(agent_dict_raw, dict):
                    agent_dict_json = json.dumps(agent_dict_raw, ensure_ascii=False)
                else:
                    agent_dict_json = None

                # Basic checks
                if (
                    not isinstance(research_goal, str)
                    or not isinstance(created_at, str)
                    or root_agent_id is None
                    or agent_counter is None
                    or agent_dict_json is None
                ):
                    await self._emit_with_record(
                        "error",
                        {"message": "Missing or invalid fields in direct import data"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                # Determine target project ID: update existing if found, else create new
                project_id_str = str(project_id_in) if project_id_in is not None else None

                # Update DB with imported fields (title via research_goal)
                update_payload = {
                    "project_id": project_id_str,
                    "research_goal": research_goal,
                    "root_agent_id": root_agent_id,
                    "agent_counter": agent_counter,
                    "agent_dict": agent_dict_json,
                    "created_at": created_at,
                }
                self.db_manager.import_project(update_payload, self.user_id)

                # Emit updated project list to all clients
                project_list = self.db_manager.list_titles(self.user_id)
                await self._emit_with_record(
                    "b2f_provide_project_list",
                    project_list,
                    room=self.GLOBAL_ROOM_NAME,
                )

            except Exception as e:
                print(f"[Server] Error importing project: {e}")
                await self._emit_with_record(
                    "error",
                    {"message": "Exception importing project"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return
            
        @self.sio.event
        async def f2b_import_project(sid: str, data: dict[str, Any]) -> None:
            """Import project from Base64-encoded pickle payload.

            Expected payload: { "data": "<base64-string>" }

            The base64 string should decode to a pickled Python object that is
            the same structure produced by export_project (a dict with
            research_goal, root_agent_id, created_at, agent_counter, agent_dict).
            """
            print(f"\n[SocketIO] f2b_import_project from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_import_project", data)

            try:
                if not data or not isinstance(data, dict):
                    await self._emit_with_record(
                        "error",
                        {"message": "Invalid payload for import: expected object with 'data' field"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                b64 = data.get("data")
                if not b64 or not isinstance(b64, str):
                    await self._emit_with_record(
                        "error",
                        {"message": "Missing or invalid 'data' field for import"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                # Decode Base64
                try:
                    pickle_bytes = base64.b64decode(b64)
                except Exception as e:
                    print(f"[Server] Error decoding base64 import payload: {e}")
                    await self._emit_with_record(
                        "error",
                        {"message": "Failed to decode base64 payload"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                # Unpickle
                try:
                    imported_obj = pickle.loads(pickle_bytes)
                except Exception as e:
                    print(f"[Server] Error unpickling import payload: {e}")
                    await self._emit_with_record(
                        "error",
                        {"message": "Failed to unpickle payload"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                if not isinstance(imported_obj, dict):
                    await self._emit_with_record(
                        "error",
                        {"message": "Imported payload must be a dict"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                # Reuse database import logic (same shape expected as export_project)
                inserted_id = self.db_manager.import_project(imported_obj, self.user_id)
                if not inserted_id:
                    print(f"[Server] DB import_project failed for payload")
                    await self._emit_with_record(
                        "error",
                        {"message": "Failed to import project into database"},
                        room=self.GLOBAL_ROOM_NAME,
                    )
                    return

                # Notify clients that import completed and provide project id
                await self._emit_with_record(
                    "b2f_import_project",
                    {"project_id": str(inserted_id)},
                    room=self.GLOBAL_ROOM_NAME,
                )

                # Also update project list and request update for the new project
                await self._emit_project_list()
                await self.project_manager.send_project_update(str(inserted_id))

                print(f"[Server] Successfully imported project id {inserted_id}")

            except Exception as e:
                print(f"[Server] Exception handling f2b_import_project: {e}")
                await self._emit_with_record(
                    "error",
                    {"message": "Internal server error during import"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

        @self.sio.event
        async def f2b_save_context_list(sid: str, data: dict[str, Any]) -> None:
            """
            Save the root agent's context_list to a local JSON file.
            Expected data: {"project_id": str}
            """
            print(f"\n[SocketIO] f2b_save_context_list from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_save_context_list", data)

            # 1. Parse and validate input
            project_id = data.get("project_id")
            if not project_id:
                await self._emit_with_record(
                    "error",
                    {"message": "project_id is required"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            # 2. Verify project exists
            project = self.project_manager.get_project(project_id)
            if not project:
                await self._emit_with_record(
                    "error",
                    {"message": "Project not found"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            # 3. Get root agent ID and state
            root_agent_id = self.project_manager.get_root_agent_id(project_id)
            if not root_agent_id:
                await self._emit_with_record(
                    "error",
                    {"message": "Root agent not found for project"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            agent_state = self.project_manager.get_agent_state(project_id, root_agent_id)
            if not agent_state:
                await self._emit_with_record(
                    "error",
                    {"message": "Agent state not found"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            # 4. Get context_list from agent state
            context_list = agent_state.context_list

            # 5. Create output directory if not exists
            output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "saved_context")
            os.makedirs(output_dir, exist_ok=True)

            # 6. Save context_list to JSON file
            output_file = os.path.join(output_dir, f"context_list_project_{project_id}.json")
            try:
                with open(output_file, "w", encoding="utf-8") as f:
                    json.dump(context_list, f, ensure_ascii=False, indent=2, default=str)
                print(f"[Server] Saved context_list to {output_file}")

                await self._emit_with_record(
                    "b2f_save_context_list",
                    {
                        "project_id": project_id,
                        "file_path": output_file,
                        "message": "Context list saved successfully",
                    },
                    room=self.GLOBAL_ROOM_NAME,
                )
            except Exception as e:
                print(f"[Server] Error saving context_list: {e}")
                await self._emit_with_record(
                    "error",
                    {"message": f"Failed to save context_list: {str(e)}"},
                    room=self.GLOBAL_ROOM_NAME,
                )

        @self.sio.event
        async def f2b_trace_source(sid: str, data: dict[str, Any]) -> None:
            """
            Trace the information source for a given content.
            Expected data: {
                "project_id": str,
                "card_id": str,
                "content_to_trace": str,
                "request_id": str  # Unique identifier for this trace request
            }
            """
            print(f"\n[SocketIO] f2b_trace_source from {sid}")
            # Record frontend message
            if self.recorder:
                self.recorder.record_frontend_message("f2b_trace_source", data)

            # 1. Parse and validate input
            project_id = data.get("project_id")
            card_id = data.get("card_id")
            content_to_trace = data.get("content_to_trace")
            request_id = data.get("request_id", "dummy_for_not_recieve_request_id") # Use default request_id for legacy compatibility
            if project_id is None or card_id is None or content_to_trace is None:
                await self._emit_with_record(
                    "error",
                    {"message": "Missing required fields (project_id, card_id, content_to_trace)"},
                    room=self.GLOBAL_ROOM_NAME,
                )
                return

            # 2. Initialize info trace state with "Running" status
            from IDR_backend.data_models.agent_models import InfoTraceState
            root_agent_id = self.project_manager.get_root_agent_id(project_id)
            agent_state = self.project_manager.get_agent_state(project_id, root_agent_id)
            agent_state.info_trace_state_dict[request_id] = InfoTraceState(
                status="Running",
                trace_result_tree=None,
            )
            
            # 3. Send initial update to frontend (status: Running)
            await self.project_manager.send_project_update(project_id)

            # 4. Run info trace agent
            try:
                print(f"[Server] Starting trace for card {card_id} in project {project_id}, request_id: {request_id}")
                trace_result = await trace_info_source(
                    project_id=project_id,
                    card_id=card_id,
                    content_to_trace=content_to_trace,
                    project_manager=self.project_manager,
                    global_config=self.project_manager.get_global_config(),
                )

                # 5. Update info trace state with result
                agent_state.info_trace_state_dict[request_id] = InfoTraceState(
                    status=trace_result["status"],
                    trace_result_tree=trace_result["trace_result_tree"],
                )
                
                # 6. Send update via b2f_update
                await self.project_manager.send_project_update(project_id)

                # 7. Also send result back via b2f_trace_source (legacy, will be removed later)
                await self._emit_with_record(
                    "b2f_trace_source",
                    trace_result,
                    room=self.GLOBAL_ROOM_NAME,
                )
                print(f"[Server] Trace completed for card {card_id}, request_id: {request_id}")

            except Exception as e:
                print(f"[Server] Error during trace: {e}")
                import traceback
                traceback.print_exc()
                
                # Update info trace state with Failed status
                agent_state.info_trace_state_dict[request_id] = InfoTraceState(
                    status="Failed",
                    trace_result_tree=None,
                )
                await self.project_manager.send_project_update(project_id)
                
                await self._emit_with_record(
                    "error",
                    {"message": f"Error during trace: {str(e)}"},
                    room=self.GLOBAL_ROOM_NAME,
                )

    async def continue_agent(
        self,
        project_id: str,
        agent_id: str,
        message: str,
        reference_list: list[dict[str, Any]],
    ):
        """
        Continue an existing agent's execution after user input.

        Args:
            project_id: Project ID
            agent_id: Agent ID
            message: User message
            reference_list: List of card references from frontend, each containing:
                - card_id: ID of the referenced card
                - selected_content: Selected text content (None means entire card)
        """
        try:
            print(f"\n[Server] Continuing agent {agent_id} in project {project_id}")

            # 1. Set agent state is_interrupted to False.
            self.project_manager.set_agent_interrupted(project_id, agent_id, False)
            self.project_manager.set_agent_final_result_generated(project_id, agent_id, False)

            # 2. Get existing agent instance
            agent_state = self.project_manager.get_agent_state(project_id, agent_id)
            if not agent_state:
                print(f"[Server] Error: Agent state not found for agent {agent_id}")
                return
            # Use ProjectManager to obtain (and lazily create) the agent instance
            try:
                agent_instance = self.project_manager.get_agent_instance(project_id, agent_id)
            except Exception as e:
                print(f"[Server] Error: Agent instance not available for agent {agent_id}: {e}")
                return

            # 3. Continue execution - pass reference_list directly to agent
            await agent_instance.run(user_message=message, reference_list=reference_list)

            # 4. Send final update.
            await self.project_manager.send_project_update(project_id)

        except Exception as e:
            print(f"[Server] Error continuing agent: {e}")
            import traceback

            traceback.print_exc()
            # Send error to global room
            await self._emit_with_record("error", {"message": str(e)}, room=self.GLOBAL_ROOM_NAME)

    def run(self, host: str = "0.0.0.0", port: int = 5000):
        """Run the server"""
        print(f"\n{'=' * 60}")
        print("  IDR Backend Server v4.0")
        print(f"  Mode: {self.server_mode}")
        print(f"  Starting on {host}:{port}")
        print(f"  Global Room Name: {self.GLOBAL_ROOM_NAME}")
        print(f"{'=' * 60}\n")

        uvicorn.run(self.socket_app, host=host, port=port)


# Main entry point
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IDR Backend Server v4")

    parser.add_argument("--host", default="0.0.0.0", help="Server host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5001, help="Server port (default: 5001)")
    parser.add_argument(
        "--global_config",
        default="configs/default_config.yaml",
        help="Path to global config file (default: configs/default_config.yaml)",
    )
    parser.add_argument(
        "--global_room_name",
        default="idr_global",
        help="Global room name (default: idr_global)",
    )
    parser.add_argument(
        "--mode",
        choices=["normal", "record", "replay"],
        default=None,
        help="Server mode (overrides config file setting)",
    )
    args = parser.parse_args()

    # 1. Load global config
    global_config = load_config(args.global_config)

    # 2. Determine server mode (CLI arg takes precedence over config)
    server_mode = args.mode or global_config.get("server_mode", "normal")
    record_path = global_config.get("server_record_path", "server_records/record.json")
    replay_interval = global_config.get("replay_default_interval", 0.5)

    print(f"[Main] Server mode: {server_mode}")

    # 3. Start appropriate server based on mode
    if server_mode == "replay":
        # Replay mode - use ReplayServer
        replay_server = ReplayServer(
            record_path=record_path,
            default_interval=replay_interval,
            global_room_name=args.global_room_name,
        )
        replay_server.run(host=args.host, port=args.port)
    else:
        # Normal or Record mode - use IDRServer
        project_manager = ProjectManager(global_config=global_config)
        server = IDRServer(
            global_room_name=args.global_room_name,
            project_manager=project_manager,
            server_mode=server_mode,  # type: ignore
            record_path=record_path if server_mode == "record" else None,
        )
        server.run(host=args.host, port=args.port)
