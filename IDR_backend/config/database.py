import sqlite3
from pathlib import Path
import json
from typing import Any
from datetime import datetime

# Base directory for storing one unified database
USER_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "user_data"
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = USER_DATA_DIR / "data.db"

class DatabaseManager:
    _shared_data = {}
    next_project_id = 0

    def __init__(self, disable: bool = True):
        """
        Initialize the database manager.
        Will auto-create tables if the database does not exist.
        """
        self.db_path = DB_PATH
        self.disable = disable
        self._init_db()
    
    def _get_connection(self):
        """
        Get a sqlite3 connection for the main database.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Return rows as dict-like objects
        return conn

    def _init_db(self):
        """
        Initialize database tables: users, chats, messages
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Table: users
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT UNIQUE
            )
        """)

        # Table: projects
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            project_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            create_time DATETIME DEFAULT (datetime('now','localtime')),
            last_update DATETIME DEFAULT (datetime('now','localtime')),
            title TEXT,
            root_agent_id TEXT,
            agent_counter INTEGER DEFAULT 0,
            agent_dict TEXT
        )
        """)

        # 为频繁查询的字段创建索引
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)")
        # 下多条记录（普通复合索引）
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_user_project ON projects(user_id, project_id)")

        conn.commit()
        # Ensure schema evolves when table already exists
        try:
            # Safely add columns if they do not exist (align to current schema)
            cursor.execute("PRAGMA table_info(projects)")
            columns = {row[1] for row in cursor.fetchall()}
            if "root_agent_id" not in columns:
                cursor.execute("ALTER TABLE projects ADD COLUMN root_agent_id TEXT")
            if "agent_counter" not in columns:
                cursor.execute("ALTER TABLE projects ADD COLUMN agent_counter INTEGER DEFAULT 0")
            if "agent_dict" not in columns:
                cursor.execute("ALTER TABLE projects ADD COLUMN agent_dict TEXT")
            conn.commit()
        except Exception as e:
            # Non-fatal: print and continue
            print(f"Error ensuring projects schema: {e}")
        finally:
            conn.close()
    
    def import_project(self, data: dict[str, Any], user_id: int) -> int | bool:
        research_goal = data.get('research_goal')
        root_agent_id = data.get('root_agent_id')
        agent_counter = data.get('agent_counter')
        agent_dict = data.get('agent_dict')
        # Correct key: created_at (fallback to now if missing)
        create_time = data.get('created_at')

        if self.disable:
            # Normalize agent_dict to ensure consistency with DB behavior (store as dict/obj)
            agent_dict_obj = agent_dict
            if isinstance(agent_dict, str): 
                try:
                    agent_dict_obj = json.loads(agent_dict)
                except Exception:
                    agent_dict_obj = None
            elif not isinstance(agent_dict, dict):
                agent_dict_obj = None

            DatabaseManager._shared_data['research_goal'] = research_goal
            DatabaseManager._shared_data['root_agent_id'] = root_agent_id
            DatabaseManager._shared_data['agent_counter'] = agent_counter
            DatabaseManager._shared_data['agent_dict'] = agent_dict_obj
            # Ensure create_time is formatted string to match DB behavior
            DatabaseManager._shared_data['create_time'] = create_time or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            DatabaseManager.next_project_id = DatabaseManager.next_project_id % 1000000 + 1
            return DatabaseManager.next_project_id

        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            # Normalize agent_dict: accept dict or JSON string
            if isinstance(agent_dict, str):
                try:
                    agent_dict_obj = json.loads(agent_dict)
                except Exception:
                    agent_dict_obj = None
            elif isinstance(agent_dict, dict):
                agent_dict_obj = agent_dict
            else:
                agent_dict_obj = None

            # If created_at not provided, use DB default by passing None
            create_time_value = create_time if isinstance(create_time, str) and create_time else None

            cursor.execute("""
                INSERT INTO projects (user_id, title, root_agent_id, agent_counter, agent_dict, create_time)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                user_id,
                research_goal,
                root_agent_id,
                int(agent_counter) if isinstance(agent_counter, (int, str)) and str(agent_counter).isdigit() else 0,
                json.dumps(agent_dict_obj) if agent_dict_obj is not None else None,
                create_time_value,
            ))
            inserted_id = cursor.lastrowid if cursor.lastrowid else -1
        except Exception as e:
            print(f"Error importing project: {e}")
            conn.rollback()
            return False

        conn.commit()
        conn.close()

        return inserted_id

    def delete_project(self, project_id: str, user_id: int):
        """
        Delete a project.
        """
        if self.disable:
            return
        conn = self._get_connection()
        cursor = conn.cursor()

        # Then delete the project
        cursor.execute("DELETE FROM projects WHERE project_id = ? AND user_id = ?", (project_id, user_id,))
        
        conn.commit()
        conn.close()

    # -------------------------
    # CRUD for users
    # -------------------------
    def create_user(self, user_name: str) -> int:
        """
        Create a new user if not exists, return user_id.
        """
        if self.disable:
            return 1

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO users (user_name) VALUES (?)", (user_name,))
        conn.commit()
        cursor.execute("SELECT user_id FROM users WHERE user_name = ?", (user_name,))
        row = cursor.fetchone()
        conn.close()
        return row["user_id"]

    def get_user_id(self, user_name: str):
        """
        Get user info by user_name.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id FROM users WHERE user_name = ?", (user_name,))
        row = cursor.fetchone()
        conn.close()
        return row["user_id"] if row else None

    # -------------------------
    # CRUD for projects
    # -------------------------
    def touch_project(self, project_id: str, user_id: int):
        """
        Update the last_update timestamp to current time.
        Call this whenever the project is accessed or a new message is added.
        """
        if self.disable:
            return
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE projects
            SET last_update = (datetime('now', 'localtime'))
            WHERE project_id = ? AND user_id = ?
        """, (project_id, user_id,))
        conn.commit()
        conn.close()

    def create_project(self, user_id: int, title: str = "New Project") -> int:
        """
        Create a new project for a user, return project_id.
        """
        if self.disable:
            DatabaseManager._shared_data['research_goal'] = title
            DatabaseManager._shared_data['root_agent_id'] = None
            DatabaseManager._shared_data['agent_counter'] = 0
            DatabaseManager._shared_data['agent_dict'] = {}
            DatabaseManager._shared_data['create_time'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            DatabaseManager.next_project_id = DatabaseManager.next_project_id % 1000000 + 1
            return DatabaseManager.next_project_id
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO projects (user_id, title)
                VALUES (?, ?)
            """, (user_id, title))
            conn.commit()
            conn.close()
            return cursor.lastrowid if cursor.lastrowid else -1

        except Exception as e:
            print(f"Error creating project: {e}")
            return -1
    
    def list_titles(self, user_id: int):
        """
        List all projects of a user, ordered by last_update DESC.
        """
        if self.disable:
            if 'research_goal' in DatabaseManager._shared_data:
                 return {
                    "project_list": [
                        {"id": "1", "research_goal": DatabaseManager._shared_data['research_goal']}
                    ]
                }
            else:
                 return {"project_list": []}
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT project_id, title FROM projects
                WHERE user_id = ?
                ORDER BY last_update DESC
            """, (user_id,))
            rows = cursor.fetchall()
            conn.close()
            result = {
                "project_list": [
                    {"id": str(row["project_id"]), "research_goal": row["title"]}
                    for row in rows
                ]
            }
            return result
        except Exception as e:
            print(f"Error listing projects: {e}")
            return None
    
    def update_data(self, project_id: str, root_agent_id: str, agent_counter: int, agent_dict_json: str | None, user_id: int) -> None:
        """
        Update core project fields. Expects `agent_dict_json` already serialized as JSON string.

        Args:
            project_id: Target project id as string
            root_agent_id: Current root agent id
            agent_counter: Current agent counter value
            agent_dict_json: JSON string representing the agent_dict snapshot
            user_id: Owner user id
        """
        if self.disable:
            DatabaseManager._shared_data['root_agent_id'] = root_agent_id
            DatabaseManager._shared_data['agent_counter'] = agent_counter
            DatabaseManager._shared_data['agent_dict'] = json.loads(agent_dict_json) if agent_dict_json else {}
            return
            
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                """
                UPDATE projects
                SET root_agent_id = ?,
                    agent_counter = ?,
                    agent_dict = ?
                WHERE project_id = ? AND user_id = ?
                """,
                (root_agent_id, int(agent_counter), agent_dict_json, int(project_id), user_id),
            )

            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error updating project: {e}")
            return None

    def get_project(self, project_id: str, user_id: int) -> dict[str, Any] | None:
        """
        Get the full data of a project for backend consumption.
        Returns a dict including all persisted Project fields.
        """
        if self.disable:
            if 'research_goal' not in DatabaseManager._shared_data:
                return None

            chat_messages = None
            card_dict = None
            if 'agent_dict' in DatabaseManager._shared_data and DatabaseManager._shared_data['agent_dict'] and DatabaseManager._shared_data['root_agent_id'] in DatabaseManager._shared_data['agent_dict']:
                    root_snapshot = DatabaseManager._shared_data['agent_dict'][DatabaseManager._shared_data['root_agent_id']]
                    chat_messages = root_snapshot.get("chat_list")
                    card_dict = root_snapshot.get("card_dict")
            return {
                "project_id": project_id,
                "research_goal": DatabaseManager._shared_data.get('research_goal'),
                "root_agent_id": DatabaseManager._shared_data.get('root_agent_id'),
                "created_at": DatabaseManager._shared_data.get('create_time'),
                "agent_counter": DatabaseManager._shared_data.get('agent_counter', 0),
                "chat_messages": chat_messages,
                "card_dict": card_dict,
                "agent_dict": DatabaseManager._shared_data.get('agent_dict', {}),
            }
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT project_id, title, root_agent_id, agent_counter, create_time,
                       agent_dict
                FROM projects
                WHERE project_id = ? AND user_id = ?
                """,
                (int(project_id), user_id),
            )
            row = cursor.fetchone()
            conn.close()
            if not row:
                return None
            agent_dict_obj = json.loads(row["agent_dict"]) if row["agent_dict"] else None
            # Derive chat_messages and card_dict from agent_dict (root agent snapshot)
            chat_messages = None
            card_dict = None
            try:
                if agent_dict_obj and row["root_agent_id"] in agent_dict_obj:
                    root_snapshot = agent_dict_obj[row["root_agent_id"]]
                    chat_messages = root_snapshot.get("chat_list")
                    card_dict = root_snapshot.get("card_dict")
            except Exception:
                # Be defensive: if structure differs, keep derived fields None
                pass
            return {
                "project_id": str(row["project_id"]),
                "research_goal": row["title"],
                "root_agent_id": row["root_agent_id"],
                "created_at": row["create_time"],
                "agent_counter": row["agent_counter"],
                "chat_messages": chat_messages,
                "card_dict": card_dict,
                "agent_dict": agent_dict_obj,
            }
        except Exception as e:
            print(f"Error getting project data: {e}")
            return None
    
    def export_project(self, project_id: str, user_id: int) -> dict[str, Any] | None:
        """
        Export full project data for external use (e.g., backup/export).
        Includes all persisted fields.
        """
        if self.disable:
            return {
                "research_goal": DatabaseManager._shared_data.get("research_goal"),
                "root_agent_id": DatabaseManager._shared_data.get("root_agent_id"),
                "created_at": DatabaseManager._shared_data.get("create_time"),
                "agent_counter": DatabaseManager._shared_data.get("agent_counter"),
                "agent_dict": DatabaseManager._shared_data.get("agent_dict"),
            }
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT project_id, title, root_agent_id, agent_counter, create_time,
                       agent_dict
                FROM projects
                WHERE project_id = ? AND user_id = ?
                """,
                (int(project_id), user_id),
            )
            row = cursor.fetchone()
            conn.close()
            if not row:
                return None
            agent_dict_obj = json.loads(row["agent_dict"]) if row["agent_dict"] else None
            try:
                if agent_dict_obj and row["root_agent_id"] in agent_dict_obj:
                    root_snapshot = agent_dict_obj[row["root_agent_id"]]
            except Exception:
                pass
            return {
                "research_goal": row["title"],
                "root_agent_id": row["root_agent_id"],
                "created_at": row["create_time"],
                "agent_counter": row["agent_counter"],
                "agent_dict": agent_dict_obj,
            }
        except Exception as e:
            print(f"Error exporting project: {e}")
            return None
    
    def print_all_projects(self):
        """
        For debugging: print all projects in the database.
        """
        if self.disable:
            # Return data structure consistent with DB row (title instead of research_goal)
            data = DatabaseManager._shared_data.copy()
            if 'research_goal' in data:
                data['title'] = data.pop('research_goal')
            return [data]
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM projects ORDER BY last_update DESC")
            rows = cursor.fetchall()
            conn.close()
            return [dict(row) for row in rows]
        except Exception as e:
            print(f"Error printing all projects: {e}")
            return None

   