"""Tests for hierarchical summarization logic."""

import pytest

from app.services.summary_service import (
    HIERARCHICAL_CHAR_THRESHOLD,
    HIERARCHICAL_SEGMENT_THRESHOLD,
    _format_time,
    _should_use_hierarchical,
    _split_into_time_groups,
)


class TestSplitIntoTimeGroups:
    """Tests for _split_into_time_groups."""

    def test_basic_grouping(self):
        """Segments within 120s should be in one group, beyond that starts a new group."""
        segments = [
            {"start": 0, "end": 10, "text": "hello"},
            {"start": 60, "end": 70, "text": "world"},
            {"start": 130, "end": 140, "text": "foo"},
            {"start": 250, "end": 260, "text": "bar"},
        ]
        groups = _split_into_time_groups(segments, group_duration_seconds=120)
        # Group 1: [0s, 60s] (60-0<120). Group 2: [130s] (130-0>=120 splits, 250-130>=120 splits). Group 3: [250s].
        assert len(groups) == 3
        assert len(groups[0]) == 2  # [0s, 60s]
        assert len(groups[1]) == 1  # [130s]
        assert len(groups[2]) == 1  # [250s]

    def test_empty_segments(self):
        """Empty input returns empty list."""
        groups = _split_into_time_groups([], group_duration_seconds=120)
        assert groups == []

    def test_single_segment(self):
        """Single segment returns one group."""
        segments = [{"start": 0, "end": 10, "text": "only one"}]
        groups = _split_into_time_groups(segments, group_duration_seconds=120)
        assert len(groups) == 1
        assert groups[0] == segments

    def test_all_within_one_group(self):
        """All segments within duration stay in one group."""
        segments = [
            {"start": 0, "end": 10, "text": "a"},
            {"start": 30, "end": 40, "text": "b"},
            {"start": 90, "end": 100, "text": "c"},
        ]
        groups = _split_into_time_groups(segments, group_duration_seconds=120)
        assert len(groups) == 1
        assert len(groups[0]) == 3

    def test_many_short_groups(self):
        """With short duration threshold, creates many groups."""
        segments = [
            {"start": i * 10, "end": i * 10 + 5, "text": f"seg{i}"}
            for i in range(20)
        ]
        # 30s groups: segments at 0,10,20 in group 1; 30,40,50 in group 2; etc.
        groups = _split_into_time_groups(segments, group_duration_seconds=30)
        assert len(groups) >= 5

    def test_custom_duration(self):
        """Custom group_duration_seconds is respected."""
        segments = [
            {"start": 0, "end": 5, "text": "a"},
            {"start": 50, "end": 55, "text": "b"},
            {"start": 65, "end": 70, "text": "c"},
            {"start": 120, "end": 125, "text": "d"},
        ]
        groups = _split_into_time_groups(segments, group_duration_seconds=60)
        # Group 1: [0, 50] (50-0<60). Group 2: [65, 120] (65-0>=60 splits; 120-65=55<60 stays).
        assert len(groups) == 2
        assert len(groups[0]) == 2
        assert len(groups[1]) == 2


class TestFormatTime:
    """Tests for _format_time helper."""

    def test_seconds_only(self):
        assert _format_time(45) == "0:45"

    def test_minutes_and_seconds(self):
        assert _format_time(125) == "2:05"

    def test_hours(self):
        assert _format_time(3661) == "1:01:01"

    def test_zero(self):
        assert _format_time(0) == "0:00"

    def test_float_input(self):
        assert _format_time(90.7) == "1:30"


class TestShouldUseHierarchical:
    """Tests for _should_use_hierarchical decision logic."""

    def test_long_text_triggers(self):
        """Text exceeding char threshold triggers hierarchical."""
        long_text = "x" * (HIERARCHICAL_CHAR_THRESHOLD + 1)
        segments = [{"start": 0, "end": 10, "text": "seg"}] * 10
        assert _should_use_hierarchical(long_text, segments) is True

    def test_many_segments_triggers(self):
        """Many segments exceeding threshold triggers hierarchical."""
        short_text = "x" * 5000
        segments = [{"start": i, "end": i + 1, "text": "s"} for i in range(HIERARCHICAL_SEGMENT_THRESHOLD + 1)]
        assert _should_use_hierarchical(short_text, segments) is True

    def test_short_text_few_segments_no_trigger(self):
        """Short text with few segments does not trigger hierarchical."""
        short_text = "x" * 5000
        segments = [{"start": 0, "end": 10, "text": "seg"}] * 10
        assert _should_use_hierarchical(short_text, segments) is False

    def test_threshold_boundary_char(self):
        """Exactly at char threshold does not trigger (must exceed)."""
        text = "x" * HIERARCHICAL_CHAR_THRESHOLD
        segments = [{"start": 0, "end": 10, "text": "s"}] * 10
        assert _should_use_hierarchical(text, segments) is False

    def test_threshold_boundary_segment(self):
        """Exactly at segment threshold does not trigger (must exceed)."""
        text = "x" * 5000
        segments = [{"start": i, "end": i + 1, "text": "s"} for i in range(HIERARCHICAL_SEGMENT_THRESHOLD)]
        assert _should_use_hierarchical(text, segments) is False
