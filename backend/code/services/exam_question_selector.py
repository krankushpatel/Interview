import random
from typing import List, Dict, Any, Optional
from code.core.data_manager import db, load_questions

DEFAULT_INTRO_QUESTION = {
    "id": 1,
    "question": "Please introduce yourself, describing your background, key technical strengths, and recent software projects.",
    "category": "Introduction",
    "difficulty": "Easy",
    "keywords": ["introduce", "background", "education", "experience", "projects", "strengths", "skills"]
}

def is_intro_q(q: Any) -> bool:
    if not isinstance(q, dict):
        return False
    if q.get("id") == 1 or str(q.get("id")) == "1":
        return True
    cat = (q.get("category") or "").strip().lower()
    if cat in ("introduction", "intro", "self-introduction", "self introduction"):
        return True
    text = (q.get("question") or q.get("text") or "").strip().lower()
    return any(p in text for p in (
        "introduce yourself", "tell me about yourself", "describe yourself", "walk me through your background"
    ))

def get_random_items(arr: list, count: int) -> list:
    if not arr or count <= 0:
        return []
    shuffled = list(arr)
    random.shuffle(shuffled)
    return shuffled[:count]

def select_exam_questions_for_student(username: str, timetable_topics: Optional[List[str]] = None) -> List[str]:
    """
    Selects questions for a student following the exact same algorithm as the student exam portal:
    1. Looks up the student's batch in db.batches.
    2. If batch has topicDistribution, strictly samples by topic, difficulty (l1, l2, l3), and class.
    3. Else if batch has topicCounts, samples by topic with equal difficulty split.
    4. Else falls back to timetable_topics (1 Intro + 3 Easy + 3 Medium + 3 Hard) = 10 questions.
    5. Always prepends 'Introduce Yourself' as Question 1.
    Returns: List of question text strings.
    """
    all_q_raw = load_questions() or []
    # Normalize question format
    all_q = []
    for q in all_q_raw:
        q_text = (q.get("question") or q.get("text") or "").strip()
        if q_text:
            q_copy = dict(q)
            q_copy["question"] = q_text
            all_q.append(q_copy)

    # Locate intro question
    intro_q = next((q for q in all_q if is_intro_q(q)), DEFAULT_INTRO_QUESTION)
    intro_text = intro_q.get("question") or DEFAULT_INTRO_QUESTION["question"]

    # Filter out intro from pool of technical questions
    tech_pool = [q for q in all_q if not is_intro_q(q)]

    # Fetch batch settings for student
    batch = db.batches.find_one({"students": username})
    settings = (batch or {}).get("settings") or {}
    topic_distribution = settings.get("topicDistribution")
    topic_counts = settings.get("topicCounts")

    final_questions: List[str] = []

    # ── SCENARIO A: Topic Distribution (Topic + Class + Difficulty L1/L2/L3) ──
    if topic_distribution and isinstance(topic_distribution, list) and len(topic_distribution) > 0:
        for rule in topic_distribution:
            topic = (rule.get("topic") or "").strip()
            target_classes = [c.strip().lower() for c in rule.get("targetClasses", []) if c.strip()]
            l1 = rule.get("l1", 0)
            l2 = rule.get("l2", 0)
            l3 = rule.get("l3", 0)
            target = l1 + l2 + l3
            if target <= 0:
                continue

            # Filter questions matching this topic and optional class
            topic_q = []
            for q in tech_pool:
                cat = (q.get("category") or "").strip().lower()
                if cat != topic.lower():
                    continue
                if target_classes:
                    q_class = str(q.get("class_name") or q.get("className") or q.get("class") or "all").strip().lower()
                    if not any(c == q_class for c in target_classes):
                        continue
                topic_q.append(q)

            easy_q = [q for q in topic_q if (q.get("difficulty") or "").strip().lower() == "easy"]
            med_q = [q for q in topic_q if (q.get("difficulty") or "").strip().lower() == "medium"]
            hard_q = [q for q in topic_q if (q.get("difficulty") or "").strip().lower() == "hard"]

            selected = (
                get_random_items(easy_q, l1) +
                get_random_items(med_q, l2) +
                get_random_items(hard_q, l3)
            )

            # Fallback if specific difficulty count was short
            if len(selected) < target:
                selected_ids = {id(q) for q in selected}
                remaining = [q for q in topic_q if id(q) not in selected_ids]
                needed = target - len(selected)
                selected.extend(get_random_items(remaining, needed))

            for q in selected:
                final_questions.append(q["question"])

    # ── SCENARIO B: Topic Counts (Category counts with balanced difficulty) ──
    elif topic_counts and isinstance(topic_counts, dict) and len(topic_counts) > 0:
        for topic, count in topic_counts.items():
            target = int(count or 0)
            if target <= 0:
                continue
            topic_q = [q for q in tech_pool if (q.get("category") or "").strip().lower() == topic.strip().lower()]
            if not topic_q:
                continue
            target = min(target, len(topic_q))

            easy_q = [q for q in topic_q if (q.get("difficulty") or "").strip().lower() == "easy"]
            med_q = [q for q in topic_q if (q.get("difficulty") or "").strip().lower() == "medium"]
            hard_q = [q for q in topic_q if (q.get("difficulty") or "").strip().lower() == "hard"]

            e_req = (target + 2) // 3
            m_req = (target + 1) // 3
            h_req = target - e_req - m_req

            e_sel = get_random_items(easy_q, e_req)
            m_req += (e_req - len(e_sel))
            m_sel = get_random_items(med_q, m_req)
            h_req += (m_req - len(m_sel))
            h_sel = get_random_items(hard_q, h_req)

            selected = e_sel + m_sel + h_sel
            if len(selected) < target:
                selected_ids = {id(q) for q in selected}
                remaining = [q for q in topic_q if id(q) not in selected_ids]
                selected.extend(get_random_items(remaining, target - len(selected)))

            for q in selected:
                final_questions.append(q["question"])

    # ── SCENARIO C: Default Fallback (Timetable Topics or All Topics: 3 Easy + 3 Medium + 3 Hard) ──
    else:
        pool = tech_pool
        if timetable_topics:
            t_set = {t.strip().lower() for t in timetable_topics if t.strip()}
            matched = [q for q in pool if (q.get("category") or "").strip().lower() in t_set]
            if matched:
                pool = matched

        easy = [q for q in pool if (q.get("difficulty") or "").strip().lower() == "easy"]
        med = [q for q in pool if (q.get("difficulty") or "").strip().lower() == "medium"]
        hard = [q for q in pool if (q.get("difficulty") or "").strip().lower() == "hard"]

        selected = (
            get_random_items(easy, 3) +
            get_random_items(med, 3) +
            get_random_items(hard, 3)
        )
        for q in selected:
            final_questions.append(q["question"])

    # Always ensure Intro Question is Question 1
    return [intro_text] + final_questions
