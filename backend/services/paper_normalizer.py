from datetime import datetime, timezone


def normalize_s2_paper(raw: dict) -> dict | None:
    """
    Convert a Semantic Scholar API paper response into our DB schema.
    Returns None if the paper has no ID.
    """
    paper_id = raw.get("paperId")
    if not paper_id:
        return None

    external_ids = raw.get("externalIds") or {}
    open_access_pdf = raw.get("openAccessPdf") or {}
    journal = raw.get("journal") or {}

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


def normalize_openalex_work(raw: dict) -> dict | None:
    """
    Convert an OpenAlex Work object into our DB schema.
    Returns None if the work has no ID.
    """
    openalex_id = raw.get("id")
    if not openalex_id:
        return None

    # Extract DOI — OpenAlex stores it as full URL "https://doi.org/10.xxx"
    doi_url = raw.get("doi") or ""
    doi = doi_url.replace("https://doi.org/", "") if doi_url else None

    # Extract IDs from the ids dict
    ids = raw.get("ids") or {}
    pmid_url = ids.get("pmid") or ""
    pmid = pmid_url.replace("https://pubmed.ncbi.nlm.nih.gov/", "") if pmid_url else None

    # Authors from authorships
    authors = [
        {
            "name": a.get("author", {}).get("display_name"),
            "s2_id": None,  # OpenAlex uses its own IDs
        }
        for a in (raw.get("authorships") or [])
    ]

    # Publication type mapping
    work_type = raw.get("type")
    type_map = {
        "article": "JournalArticle",
        "review": "Review",
        "preprint": "Preprint",
        "book-chapter": "BookChapter",
        "proceedings-article": "Conference",
        "book": "Book",
        "dataset": "Dataset",
    }
    publication_type = type_map.get(work_type, work_type)

    # Journal from primary location
    primary_location = raw.get("primary_location") or {}
    source = primary_location.get("source") or {}
    journal = source.get("display_name")

    # Open access
    open_access = raw.get("open_access") or {}
    is_oa = open_access.get("is_oa", False)
    pdf_url = open_access.get("oa_url")

    # Fields of study from topics/concepts
    topics = raw.get("topics") or []
    fields = list({t.get("display_name") for t in topics[:5] if t.get("display_name")})

    # Abstract — OpenAlex stores it as an inverted index, need to reconstruct
    abstract = _reconstruct_abstract(raw.get("abstract_inverted_index"))

    # Use OpenAlex ID as s2_id (our primary key)
    # Strip the URL prefix to get just the ID
    short_id = openalex_id.replace("https://openalex.org/", "")

    return {
        "s2_id": short_id,
        "doi": doi,
        "pubmed_id": pmid,
        "arxiv_id": None,
        "title": raw.get("title"),
        "abstract": abstract,
        "year": raw.get("publication_year"),
        "authors": authors,
        "journal": journal,
        "publication_type": publication_type,
        "citation_count": raw.get("cited_by_count"),
        "reference_count": len(raw.get("referenced_works") or []),
        "is_open_access": is_oa,
        "pdf_url": pdf_url,
        "fields_of_study": fields if fields else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def _reconstruct_abstract(inverted_index: dict | None) -> str | None:
    """
    OpenAlex stores abstracts as an inverted index:
    {"word": [0, 5, 10], "another": [1, 6]} → reconstruct into text.
    """
    if not inverted_index:
        return None

    word_positions = []
    for word, positions in inverted_index.items():
        for pos in positions:
            word_positions.append((pos, word))

    word_positions.sort()
    return " ".join(word for _, word in word_positions)


# Default normalizer — Semantic Scholar
normalize_paper = normalize_s2_paper
