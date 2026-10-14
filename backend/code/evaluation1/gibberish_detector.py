"""
gibberish_detector.py – Deterministic detection of unintelligible text.
No LLM calls. Pure heuristics.
"""
import re
from collections import Counter
from typing import Tuple


# Valid short answers that should never be flagged
VALID_SHORT_ANSWERS = {
    'yes', 'no', 'true', 'false', 'none', 'null', 'na', 'n/a', 'nil',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
    'alpha', 'beta', 'gamma', 'delta', 'sigma', 'omega', 'theta', 'lambda', 'pi',
}

# Keyboard adjacency patterns (common mashes)
KEYBOARD_MASHES = [
    'asdf', 'qwer', 'zxcv', 'jkl;', 'fghj', 'sdfg', 'wert', 'yuiop',
    'ghjk', 'hjkl', 'qaz', 'wsx', 'edc', 'rfv', 'tgb', 'yhn', 'ujm',
    'poiuy', 'lkjhg', 'mnbvc', 'dfghj', 'sdfgh', 'qwert', 'asdfg',
]

# Common English bigrams (real text has these)
COMMON_BIGRAMS = [
    'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd',
    'ti', 'es', 'or', 'te', 'of', 'ed', 'is', 'it', 'al', 'ar',
    'st', 'to', 'nt', 'ng', 'se', 'ha', 'as', 'ou', 'io', 'le',
    've', 'co', 'me', 'de', 'hi', 'ri', 'ro', 'ic', 'ne', 'ea',
]


def is_gibberish(text: str) -> bool:
    """
    Returns True if text appears to be gibberish, random typing, or unintelligible.
    
    Designed to be conservative: when in doubt, return False.
    Better to let an unusual answer through than to wrongly reject a valid one.
    """
    if not text or not isinstance(text, str):
        return True
    
    text = text.strip()
    if not text:
        return True
    
    if re.search(r'[\d+\-*/=<>≡%ΩV]', text):
        if re.search(r'[\d]', text) and (re.search(r'[+\-*/=]', text) or re.search(r'[VΩ%]', text)):
            return False
    
    # Allow very short answers (up to 25 chars)
    if len(text) <= 25:
        text_lower = text.lower().strip().rstrip('.,!?;:')
        if text_lower in VALID_SHORT_ANSWERS:
            return False
        # Single word with vowels is likely valid
        words = text.split()
        if len(words) == 1:
            word = text_lower
            # Has vowels - likely a real word
            if re.search(r'[aeiou]', word):
                # But check it's not all same char
                if len(set(word)) > 1:
                    return False
            # Pure numbers or number with units
            if re.match(r'^[\d.,]+$', text.strip()):
                return False
            # Number with unit like "5km" or "100ms"
            if re.match(r'^[\d.]+\s*[a-z%]*$', text.strip()):
                return False
    
    # Check for obvious patterns indicating gibberish
    
    # 1. Repeated single character (aaaa, bbbb)
    if re.search(r'(.)\1{4,}', text):
        return True
    
    # 2. Keyboard mashes
    text_lower = text.lower()
    for mash in KEYBOARD_MASHES:
        if mash in text_lower:
            return True
    
    # 3. Only consonants, no vowels (for longer text)
    alpha_chars = [c for c in text_lower if c.isalpha()]
    if len(alpha_chars) > 5:
        vowel_count = sum(1 for c in alpha_chars if c in 'aeiou')
        if vowel_count == 0:
            return True
    
    # 4. Too many special characters relative to text
    special_chars = [c for c in text if not c.isalnum() and not c.isspace()]
    if len(special_chars) > len(text) * 0.4 and len(text) > 10:
        return True
    
    # 5. Repeating patterns (abcabcabc)
    if len(text) > 8:
        for pattern_len in range(2, len(text) // 2):
            pattern = text[:pattern_len]
            repeats = len(text) // pattern_len
            if pattern * repeats == text[:pattern_len * repeats]:
                return True
    
    # 6. Very low bigram diversity (real text has common patterns)
    if len(text_lower) > 15:
        bigram_count = sum(1 for bg in COMMON_BIGRAMS if bg in text_lower)
        # Real English text of this length typically has 3+ common bigrams
        if bigram_count == 0:
            # Double-check with character diversity
            unique_chars = len(set(text_lower.replace(' ', '')))
            if unique_chars > 5:  # Has diversity but no common patterns
                return True
    
    # 7. Alternating pattern (abababab)
    if len(text) > 6:
        if len(text) >= 4:
            # Check for 2-char alternation
            if len(text) >= 6:
                pair1 = text[0:2]
                pair2 = text[2:4]
                if pair1 == pair2 and text[0] != text[1]:
                    # Check if pattern continues
                    expected = (pair1 + pair2) * (len(text) // 4 + 1)
                    if expected[:len(text)] == text:
                        return True
    
    return False


def get_gibberish_reason(text: str) -> Tuple[bool, str]:
    """
    Returns (is_gibberish, reason) tuple.
    Useful for explaining why something was flagged.
    """
    if not is_gibberish(text):
        return False, ""
    
    text = text.strip() if text else ""
    
    if not text:
        return True, "Empty answer"
    
    if re.search(r'(.)\1{4,}', text):
        return True, "Contains repeated characters"
    
    text_lower = text.lower()
    for mash in KEYBOARD_MASHES:
        if mash in text_lower:
            return True, "Contains keyboard mash pattern"
    
    alpha_chars = [c for c in text_lower if c.isalpha()]
    if len(alpha_chars) > 5 and sum(1 for c in alpha_chars if c in 'aeiou') == 0:
        return True, "Contains no vowels"
    
    special_chars = [c for c in text if not c.isalnum() and not c.isspace()]
    if len(special_chars) > len(text) * 0.4:
        return True, "Contains too many special characters"
    
    if len(text) > 8:
        for pattern_len in range(2, len(text) // 2):
            pattern = text[:pattern_len]
            if pattern * (len(text) // pattern_len) == text[:pattern_len * (len(text) // pattern_len)]:
                return True, "Contains repeating pattern"
    
    if len(text_lower) > 15:
        bigram_count = sum(1 for bg in COMMON_BIGRAMS if bg in text_lower)
        if bigram_count == 0:
            return True, "Lacks common text patterns"
    
    return True, "Appears to be unintelligible text"
