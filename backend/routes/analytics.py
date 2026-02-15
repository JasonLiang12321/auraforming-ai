from flask import Blueprint, jsonify
from storage import get_completed_sessions, COMPLETED_DIR
from datetime import datetime
import json

analytics_bp = Blueprint('analytics', __name__)

@analytics_bp.route('/api/admin/agents/<agent_id>/analytics')
def get_agent_analytics(agent_id: str):
    """Get analytics for a specific agent"""
    try:
        sessions = get_completed_sessions()
        agent_sessions = [s for s in sessions if s.get('agent_id') == agent_id]
        
        total_sessions = len(agent_sessions)
        completed_sessions = total_sessions  # All sessions in this table are completed
        incomplete_sessions = 0
        completion_rate = 100.0 if total_sessions > 0 else 0
        
        # Calculate average duration
        durations = []
        for s in agent_sessions:
            if s.get('completed_at') and s.get('created_at'):
                try:
                    start = datetime.fromisoformat(s['created_at'].replace('Z', '+00:00'))
                    end = datetime.fromisoformat(s['completed_at'].replace('Z', '+00:00'))
                    duration_minutes = (end - start).total_seconds() / 60
                    if duration_minutes > 0:
                        durations.append(duration_minutes)
                except:
                    pass
        
        avg_duration = f"{round(sum(durations) / len(durations), 1)} min" if durations else "N/A"
        
        # Count total turns (answers)
        total_turns = sum(len(s.get('answers', {})) for s in agent_sessions)
        
        # Language breakdown
        languages = {}
        for s in agent_sessions:
            lang_code = s.get('language_code', 'en-US')
            lang_label = s.get('language_label', 'English (US)')
            if lang_code not in languages:
                languages[lang_code] = {'code': lang_code, 'label': lang_label, 'count': 0}
            languages[lang_code]['count'] += 1
        
        # Average fields completed
        field_counts = [len(s.get('answers', {})) for s in agent_sessions if s.get('answers')]
        avg_fields = round(sum(field_counts) / len(field_counts), 1) if field_counts else 0
        
        return jsonify({
            'total_sessions': total_sessions,
            'completed_sessions': completed_sessions,
            'incomplete_sessions': incomplete_sessions,
            'completion_rate': completion_rate,
            'avg_duration': avg_duration,
            'total_turns': total_turns,
            'languages': list(languages.values()),
            'avg_fields_completed': avg_fields
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500