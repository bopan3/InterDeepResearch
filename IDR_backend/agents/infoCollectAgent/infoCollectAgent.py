from crawl4ai import AsyncWebCrawler

# Configure logging for crawl4ai to show timing information
# logging.basicConfig(level=logging.INFO)
# crawl4ai_logger = logging.getLogger('crawl4ai')
# crawl4ai_logger.setLevel(logging.INFO)


async def scrape_webpage(webpage_link: str) -> tuple[str, str]:
    """
    Simple web scraping function using AsyncWebCrawler
    Returns both markdown content and title of the webpage

    Supports both HTML pages and PDF files using Crawl4AI's native PDF support

    Returns:
        tuple: (content_of_the_webpage, title_of_the_webpage)
    """
    # Check if URL points to a PDF file
    is_pdf = webpage_link.lower().endswith(".pdf") or "/pdf/" in webpage_link.lower()

    if is_pdf:
        # Use Crawl4AI's native PDF support
        from crawl4ai.processors.pdf import PDFCrawlerStrategy, PDFContentScrapingStrategy
        from crawl4ai import CrawlerRunConfig

        pdf_crawler_strategy = PDFCrawlerStrategy()
        pdf_scraping_strategy = PDFContentScrapingStrategy(
            extract_images=False,  # Don't extract images for now
            save_images_locally=False,
        )
        run_config = CrawlerRunConfig(scraping_strategy=pdf_scraping_strategy)

        async with AsyncWebCrawler(crawler_strategy=pdf_crawler_strategy) as crawler:
            result = await crawler.arun(url=webpage_link, config=run_config)
    else:
        # For HTML pages, use standard crawling
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(
                url=webpage_link,
                page_timeout=60000,
                wait_until="domcontentloaded",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )

    if result.markdown is None:  # type: ignore
        content_of_the_webpage = "Error: Failed to access the content."
    else:
        content_of_the_webpage = result.markdown  # type: ignore

    # Access title from metadata according to crawl4ai documentation
    if result.metadata and result.metadata.get("title"):  # type: ignore
        title_of_the_webpage = result.metadata["title"]  # type: ignore
    else:
        print("Warning: No title found in metadata. Name it as Untitled.")
        title_of_the_webpage = "Untitled"

    # Print preview of scraped content
    print("\n" + "="*80)
    print("📄 Scraped Webpage Preview")
    print("="*80)
    print(f"🔗 URL: {webpage_link}")
    print(f"📌 Title: {title_of_the_webpage}")
    print(f"📊 Content Length: {len(content_of_the_webpage)} characters")
    print("-"*80)
    print("📝 Content Preview (first 500 chars):")
    preview_length = min(500, len(content_of_the_webpage))
    print(content_of_the_webpage[:preview_length])
    if len(content_of_the_webpage) > 500:
        print("...")
    print("="*80 + "\n")

    return content_of_the_webpage, title_of_the_webpage
