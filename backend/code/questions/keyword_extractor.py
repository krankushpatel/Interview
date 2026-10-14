"""
Keyword Extractor Module
Extracts domain-specific technical keywords, acronyms, and phonetic error-prone terms
from question texts to boost speech recognition accuracy in Deepgram.
Uses Google Gemini API dynamically if configured in .env, with automatic fallback
to rule-based heuristic extraction.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("questions.keyword_extractor")

# Ensure .env is loaded if python-dotenv is installed
try:
    from dotenv import load_dotenv
    # Look for .env in current folder or backend folder
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
    load_dotenv()
except Exception:
    pass

# Common general English words that might be uppercase in question texts but are NOT technical keywords
STOPWORDS = {
    "A", "AN", "THE", "AND", "OR", "BUT", "IF", "THEN", "ELSE", "WHEN", "WHERE", "WHY",
    "HOW", "WHAT", "WHICH", "WHO", "WHOM", "THIS", "THAT", "THESE", "THOSE", "IS", "ARE",
    "WAS", "WERE", "BE", "BEEN", "BEING", "HAVE", "HAS", "HAD", "DO", "DOES", "DID",
    "CAN", "COULD", "SHALL", "SHOULD", "WILL", "WOULD", "MAY", "MIGHT", "MUST", "OF",
    "IN", "TO", "FOR", "WITH", "ON", "AT", "FROM", "BY", "ABOUT", "AS", "INTO", "LIKE",
    "THROUGH", "AFTER", "OVER", "BETWEEN", "OUT", "AGAINST", "DURING", "WITHOUT", "BEFORE",
    "UNDER", "AROUND", "AMONG", "EXPLAIN", "DESCRIBE", "DEFINE", "DISCUSS", "WRITE",
    "GIVE", "FIND", "DIFFERENCE", "DIFFERENTIATE", "COMPARE", "CONTRAST", "ADVANTAGE",
    "DISADVANTAGE", "WORKING", "PRINCIPLE", "DIAGRAM", "CIRCUIT", "BRIEF", "BRIEFLY",
    "DETAIL", "DETAILS", "EXAMPLE", "EXAMPLES", "TYPE", "TYPES", "SHORT", "NOTE", "NOTES",
    "MAIN", "MAJOR", "ROLE", "PURPOSE", "MEAN", "MEANS", "MEANING", "FOLLOWING", "BELOW",
    "ABOVE", "GIVEN", "STATE", "STATEMENT", "MENTION", "LIST", "NAME", "SHOW", "DRAW",
    "ILLUSTRATE", "STEPS", "STEP", "PROCESS", "METHOD", "CONCEPT", "CONCEPTS", "OVERVIEW"
}

# Known technical acronyms & domain words commonly misrecognized by ASR (like Deepgram)
KNOWN_TECH_TERMS = {
    # Electronics / VLSI / Hardware
    "PMOS", "NMOS", "CMOS", "MOSFET", "MESFET", "BJT", "FET", "JFET", "IGBT",
    "VHDL", "VERILOG", "SYSTEMVERILOG", "FPGA", "CPLD", "ASIC", "VLSI", "ULSI",
    "RTL", "SPICE", "HSPICE", "LUT", "K-MAP", "KARNAUGH", "SRAM", "DRAM", "EEPROM",
    "FLASH", "ROM", "RAM", "ALU", "CPU", "GPU", "NPU", "TPU", "DSP", "PLL", "VCO",
    "ADC", "DAC", "PWM", "OPAMP", "OP-AMP", "DIODE", "ZENER", "SCHOTTKY", "THYRISTOR",
    "TRIAC", "DIAC", "TRANSISTOR", "CAPACITOR", "INDUCTOR", "RESISTOR", "IMPEDANCE",
    "REACTANCE", "ADMITTANCE", "TRANSCONDUCTANCE", "SUBSTRATE", "THRESHOLD", "PROPAGATION",
    "BANDWIDTH", "SLEW-RATE", "SLEW", "CMRR", "PSRR", "GAIN-BANDWIDTH", "LATCHUP",
    "FLIP-FLOP", "LATCH", "MULTIPLEXER", "DEMULTIPLEXER", "DECODER", "ENCODER",
    "COUNTER", "REGISTER", "MICROCONTROLLER", "MICROPROCESSOR", "8085", "8086", "8051",
    "ARM", "RISC", "CISC", "DMA", "INTERRUPT", "TIMER", "USART", "UART", "SPI", "I2C",
    "CAN-BUS", "GPIO", "JTAG", "PCI", "PCIE", "USB", "ETHERNET", "BLUETOOTH", "ZIGBEE",
    # Computer Science / Software / Web / DB
    "POLYMORPHISM", "INHERITANCE", "ENCAPSULATION", "ABSTRACTION", "INTERFACE",
    "RECURSION", "ITERATION", "BACKTRACKING", "MEMOIZATION", "DIJKSTRA", "BELLMAN-FORD",
    "KRUSKAL", "PRIM", "FLOYD-WARSHALL", "A-STAR", "BFS", "DFS", "BINARY-TREE", "AVL",
    "RED-BLACK", "B-TREE", "TRIE", "HEAP", "HASHMAP", "HASHTABLE", "QUEUE", "STACK",
    "LINKED-LIST", "ARRAY", "POINTER", "REFERENCE", "SEGMENTATION", "PAGING", "SEMAPHORE",
    "MUTEX", "DEADLOCK", "STARVATION", "MULTITHREADING", "CONCURRENCY", "SYNCHRONIZATION",
    "SOCKET", "TCP", "UDP", "HTTP", "HTTPS", "WEBSOCKET", "REST", "SOAP", "GRAPHQL",
    "JSON", "XML", "YAML", "DATABASE", "RDBMS", "SQL", "NOSQL", "MONGODB", "POSTGRESQL",
    "MYSQL", "SQLITE", "REDIS", "INDEXING", "NORMALIZATION", "DENORMALIZATION", "ACID",
    "BASE", "SHARDING", "REPLICATION", "DOCKER", "KUBERNETES", "CONTAINER", "CI/CD",
    "GIT", "GITHUB", "KAFKA", "RABBITMQ", "MICROSERVICES", "MONOLITH", "LAMBDA",
    # AI / Machine Learning / Data Science
    "NEURAL-NETWORK", "PERCEPTRON", "BACKPROPAGATION", "GRADIENT-DESCENT", "CNN", "RNN",
    "LSTM", "GRU", "TRANSFORMER", "ATTENTION", "BERT", "GPT", "LLM", "EMBEDDING",
    "TOKENIZER", "OVERFITTING", "UNDERFITTING", "REGULARIZATION", "DROPOUT", "EPOCH",
    "HYPERPARAMETER", "LOSS-FUNCTION", "CROSS-ENTROPY", "ACCURACY", "PRECISION", "RECALL",
    "F1-SCORE", "ROC-AUC", "CLUSTERING", "K-MEANS", "PCA", "DECISION-TREE", "RANDOM-FOREST",
    "SVM", "LOGISTIC-REGRESSION", "LINEAR-REGRESSION", "TENSORFLOW", "PYTORCH", "KERAS",
    "SCIKIT-LEARN", "PANDAS", "NUMPY", "OPENCV", "NLP", "NLTK", "SPACY", "FINE-TUNING"
}


def _extract_keywords_via_gemini(text: str, category: Optional[str] = None, max_keywords: int = 15) -> Optional[List[str]]:
    """
    Calls Google Gemini API to extract high-value domain-specific keywords and acronyms
    optimized for speech-to-text (Deepgram STT) keyword boosting.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    model_name = os.getenv("GEMINI_MODEL", "").strip() or os.getenv("GEMINI_MODEL_FALLBACK", "").strip() or "gemini-2.5-flash"
    base_url = os.getenv("GEMINI_BASE_URL", "").strip()

    prompt = f"""You are a specialized AI speech-recognition assistant.
Your task is to analyze the following technical interview or exam question and extract up to {max_keywords} critical technical keywords, acronyms, and terminology.
These keywords will be fed into a Speech-to-Text (STT / Deepgram) keyword boosting engine so that technical terms are recognized with 100% accuracy and not misheard as common words (e.g., 'CMOS' not 'sea moss', 'PMOS' not 'promise', 'VHDL' not 'we had all', 'LUT' not 'loot', 'Polymorphism' not 'police morphism').

Instructions:
1. Extract domain-specific technical words, abbreviations, acronyms, protocols, algorithm names, and hardware/software terms.
2. Maintain standard uppercase/camelCase spelling for acronyms and terms (e.g., 'PMOS', 'CMOS', 'MOSFET', 'FPGA', 'Polymorphism', 'Deadlock').
3. DO NOT include generic English stopwords, question words ('What', 'Why', 'Explain', 'Difference', 'Advantage', 'Example'), or common filler words.
4. If category '{category}' is relevant, keep the extracted terms aligned with this engineering domain.
5. Return ONLY a valid JSON array of strings, nothing else. Example: ["CMOS", "PMOS", "NMOS", "Substrate", "Threshold Voltage"]

Question:
\"\"\"{text}\"\"\"

Category: {category or 'General'}

JSON Array:"""

    import time

    attempts = 0
    max_retries = 2  # Total 3 attempts (1 initial + 2 retries)
    while attempts <= max_retries:
        attempts += 1
        try:
            from google import genai
            from google.genai import types

            kwargs = {"api_key": api_key}
            if base_url:
                kwargs["http_options"] = {"base_url": base_url}
            client = genai.Client(**kwargs)

            config = types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json"
            )
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config
            )

            resp_text = (response.text or "").strip()
            # Clean potential markdown fences
            if resp_text.startswith("```"):
                resp_text = re.sub(r"^```(?:json)?\s*", "", resp_text)
                resp_text = re.sub(r"\s*```$", "", resp_text)

            parsed = json.loads(resp_text)
            if isinstance(parsed, list):
                valid_kws = [str(k).strip() for k in parsed if isinstance(k, (str, int, float)) and str(k).strip()]
                if valid_kws:
                    return normalize_keywords(valid_kws, max_count=max_keywords)

        except Exception as e:
            if attempts <= max_retries:
                logger.warning(f"[KeywordExtractor] Gemini attempt {attempts} failed ({e}), retrying in 1s...")
                time.sleep(1.0)
            else:
                logger.warning(f"[KeywordExtractor] Gemini failed after {attempts} attempts ({e}), falling back to heuristic extractor")
                return None

    return None


def _extract_keywords_heuristic(text: str, category: Optional[str] = None, max_keywords: int = 15) -> List[str]:
    """
    Fallback heuristic rule-based keyword extractor.
    Extracts domain terms, uppercase acronyms, camelCase, and technical tokens.
    """
    found_keywords = []
    seen_lower = set()

    def add_keyword(word: str):
        cleaned = word.strip(" ,.:;()[]{}'\"?!/-_")
        if not cleaned or len(cleaned) < 2 or len(cleaned) > 30:
            return
        lower = cleaned.lower()
        if lower in STOPWORDS or lower in seen_lower:
            return
        seen_lower.add(lower)
        found_keywords.append(cleaned)

    # 1. Check known high-priority technical terms directly in text (case-insensitive search)
    text_upper = text.upper()
    for term in KNOWN_TECH_TERMS:
        pattern = r'(?<![A-Za-z0-9])' + re.escape(term) + r'(?![A-Za-z0-9])'
        if re.search(pattern, text_upper):
            match = re.search(pattern, text, re.IGNORECASE)
            add_keyword(match.group(0) if match else term)

    # 2. Extract all Uppercase Acronyms (e.g. PMOS, CMOS, NMOS, FIFO, ALU, SQL, API)
    raw_tokens = re.findall(r'\b[A-Z0-9]{2,8}(?:-[A-Z0-9]{1,8})*\b', text)
    for tok in raw_tokens:
        if tok.upper() not in STOPWORDS:
            add_keyword(tok)

    # 3. Extract PascalCase or CamelCase words (e.g. Polymorphism, BackPropagation, MicroController)
    pascal_tokens = re.findall(r'\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b', text)
    for tok in pascal_tokens:
        add_keyword(tok)

    # 4. Extract words in quotes or backticks (e.g. `const`, "SELECT", 'join')
    quoted_tokens = re.findall(r'[`\'"]([A-Za-z0-9_\-]+)[`\'"]', text)
    for tok in quoted_tokens:
        add_keyword(tok)

    # 5. Extract significant capitalized words
    words = re.findall(r'\b[A-Za-z0-9_\-]+\b', text)
    for idx, w in enumerate(words):
        if len(w) >= 3 and w[0].isupper() and idx > 0 and w.upper() not in STOPWORDS:
            add_keyword(w)

    # 6. If category is provided and not generic, add category terms as keywords
    if category and category.lower() not in {"general", "all", "misc"}:
        cat_words = re.findall(r'\b[A-Za-z0-9_\-]+\b', category)
        for cw in cat_words:
            if len(cw) >= 3 and cw.upper() not in STOPWORDS:
                add_keyword(cw)

    return found_keywords[:max_keywords]


def extract_keywords_from_text(text: str, category: Optional[str] = None, max_keywords: int = 15) -> List[str]:
    """
    Auto keyword extraction disabled.
    Returns empty list immediately to stop Gemini API calls and heuristic extraction.
    """
    return []


def normalize_keywords(keywords: List[str], max_count: int = 100) -> List[str]:
    """
    Cleans, deduplicates case-insensitively, and limits keywords list to max_count.
    Preserves uppercase or capitalized versions (e.g. PMOS over pmos).
    """
    if not keywords:
        return []

    seen = {}
    for kw in keywords:
        if not kw or not isinstance(kw, str):
            continue
        cleaned = kw.strip(" ,.:;()[]{}'\"?!")
        if not cleaned or len(cleaned) < 2:
            continue
        lower_key = cleaned.lower()
        if lower_key in seen:
            prev = seen[lower_key]
            curr_upper = sum(1 for c in cleaned if c.isupper())
            prev_upper = sum(1 for c in prev if c.isupper())
            if curr_upper > prev_upper:
                seen[lower_key] = cleaned
        else:
            seen[lower_key] = cleaned

    return list(seen.values())[:max_count]
