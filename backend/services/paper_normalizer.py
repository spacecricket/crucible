from datetime import datetime, timezone


def normalize_paper(raw: dict) -> dict | None:
    """
    Convert a Semantic Scholar API paper response into our DB schema.
    Returns None if the paper has no ID (shouldn't happen, but defensive).
    """
    paper_id = raw.get("paperId")
    if not paper_id:
        return None

    external_ids = raw.get("externalIds") or {}
    open_access_pdf = raw.get("openAccessPdf") or {}
    journal = raw.get("journal") or {}

    # publicationTypes is a list like ["JournalArticle", "Review"]
    # Store the first one as the primary type
    pub_types = raw.get("publicationTypes") or []
    primary_type = pub_types[0] if pub_types else None

    authors = [
        {"name": a.get("name"), "s2_id": a.get("authorId")}
        for a in (raw.get("authors") or [])
    ]

    return {
        "s2_id": paper_id,
        "doi": external_ids.get("DOI"),
        "pubmed_id": external_ids.get("PubMed"),
        "arxiv_id": external_ids.get("ArXiv"),
        "title": raw.get("title"),
        "abstract": raw.get("abstract"),
        "year": raw.get("year"),
        "authors": authors,
        "journal": journal.get("name"),
        "publication_type": primary_type,
        "citation_count": raw.get("citationCount"),
        "reference_count": raw.get("referenceCount"),
        "is_open_access": raw.get("isOpenAccess"),
        "pdf_url": open_access_pdf.get("url"),
        "fields_of_study": raw.get("fieldsOfStudy"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
