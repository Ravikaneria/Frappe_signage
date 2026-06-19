import frappe
from frappe.model.document import Document
from frappe.utils import get_datetime, now_datetime, getdate


_WEEKDAY_FIELDS = [
    "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday",
]


class SignageSchedule(Document):
    pass


# ─────────────────────────────────────────────────────────────────────────────
#  CORE ENGINE — find which rule (if any) is active right now
# ─────────────────────────────────────────────────────────────────────────────

def get_active_rule(schedule_name, at_datetime=None):
    """
    Given a Signage Schedule name, return the Schedule Rule (as a dict, with its
    'signages' child rows) that should be showing right now.

    Matching logic per rule:
      1. is_active must be checked
      2. If use_date_range: today's date must be within [start_date, end_date]
      3. If not all_days: today's weekday must be checked in the rule
      4. If not all_day: current time must be within [start_time, end_time]
         (handles overnight windows like 22:00-02:00 correctly)

    If multiple rules match, the one with the highest 'priority' wins.
    Ties broken by row order (idx).

    Returns None if no rule matches (caller should apply fallback behavior).
    """
    now = get_datetime(at_datetime) if at_datetime else now_datetime()
    today = getdate(now)
    weekday_field = _WEEKDAY_FIELDS[today.weekday()]  # Monday=0 ... Sunday=6
    current_time = now.time()

    schedule = frappe.db.get_value(
        "Signage Schedule", schedule_name, ["name", "is_active"], as_dict=True
    )
    if not schedule or not schedule.is_active:
        return None

    rules = frappe.get_all(
        "Schedule Rule",
        filters={"parent": schedule_name, "is_active": 1},
        fields=[
            "name", "rule_name", "priority",
            "all_day", "start_time", "end_time",
            "all_days", *_WEEKDAY_FIELDS,
            "use_date_range", "start_date", "end_date",
        ],
        order_by="priority desc, idx asc",
    )

    for rule in rules:
        if _rule_matches(rule, today, weekday_field, current_time):
            rule["signages"] = _get_rule_signages(rule.name)
            return rule

    return None


def _rule_matches(rule, today, weekday_field, current_time):
    # ── Date range check ─────────────────────────────────────────────────────
    if rule.use_date_range:
        if rule.start_date and today < rule.start_date:
            return False
        if rule.end_date and today > rule.end_date:
            return False

    # ── Day of week check ────────────────────────────────────────────────────
    if not rule.all_days:
        if not rule.get(weekday_field):
            return False

    # ── Time of day check ────────────────────────────────────────────────────
    if not rule.all_day and rule.start_time and rule.end_time:
        start_t = _to_time(rule.start_time)
        end_t = _to_time(rule.end_time)

        if start_t <= end_t:
            # Normal same-day window, e.g. 09:00 - 17:00
            if not (start_t <= current_time <= end_t):
                return False
        else:
            # Overnight window, e.g. 22:00 - 02:00
            if not (current_time >= start_t or current_time <= end_t):
                return False

    return True


def _to_time(value):
    """Frappe Time fields can come back as timedelta or time depending on context."""
    import datetime
    if isinstance(value, datetime.timedelta):
        total_seconds = int(value.total_seconds())
        h = (total_seconds // 3600) % 24
        m = (total_seconds % 3600) // 60
        s = total_seconds % 60
        return datetime.time(h, m, s)
    if isinstance(value, datetime.time):
        return value
    # Fallback: try parsing "HH:MM:SS" string
    parts = str(value).split(":")
    return datetime.time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)


def _get_rule_signages(rule_name):
    """Return the ordered, active Screen Signage Item rows for a given Schedule Rule."""
    return frappe.get_all(
        "Screen Signage Item",
        filters={"parent": rule_name, "is_active": 1},
        fields=["signage", "duration_override"],
        order_by="idx asc",
    )


@frappe.whitelist()
def preview_active_rule(schedule_name):
    """Used by the 'Preview: What's Active Now' button on the Signage Schedule form."""
    rule = get_active_rule(schedule_name)
    if not rule:
        return None
    return {
        "rule_name": rule.rule_name,
        "signages": [r["signage"] for r in rule.get("signages", [])],
    }
