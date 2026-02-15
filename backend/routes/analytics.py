from flask import Blueprint, jsonify
from storage import get_all_sessions_for_agent, get_agent
from datetime import datetime
import json

analytics_bp = Blueprint('analytics', __name__)

@analytics_bp.route('/api/admin/agents/<agent_id>/analytics')
def get_agent_analytics(agent_id: str):
    """Get analytics for a specific agent"""
    try:
        # Get agent schema to count total fields
        agent = get_agent(agent_id)
        if not agent:
            return jsonify({'error': 'Agent not found'}), 404
        
        # Count total fields from schema
        # Replace line 18 with:
        schema = agent.get('schema', {})
        if isinstance(schema, dict):
            # Try interview_fields first (list of dicts with 'key')
            interview_fields = schema.get('interview_fields', [])
            if isinstance(interview_fields, list) and interview_fields:
                total_fields = len([f for f in interview_fields if isinstance(f, dict) and f.get('key')])
            else:
                # Fallback to widget_names (list of strings)
                widget_names = schema.get('widget_names', [])
                total_fields = len([w for w in widget_names if isinstance(w, str) and w.strip()])
        else:
            total_fields = 0

        
       
        
        # Get all sessions from all_sessions table
        all_sessions = get_all_sessions_for_agent(agent_id)
        
        # Filter only completed sessions
        completed_sessions = [s for s in all_sessions if s.get('is_completed')]
        
        # Calculate average duration from completed sessions
        total_duration_seconds = 0
        valid_duration_count = 0
        
        for session in completed_sessions:
            started_at = session.get('started_at')
            completed_at = session.get('completed_at')
            
            if started_at and completed_at:
                try:
                    start_time = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                    end_time = datetime.fromisoformat(completed_at.replace('Z', '+00:00'))
                    duration_seconds = (end_time - start_time).total_seconds()
                    
                    # Filter out outliers (less than 5 seconds or more than 2 hours)
                    if 5 < duration_seconds < 7200:
                        total_duration_seconds += duration_seconds
                        valid_duration_count += 1
                        print(f"Session {session.get('session_id')}: {duration_seconds}s")
                except Exception as e:
                    print(f"Error calculating duration for session {session.get('session_id')}: {e}")
                    continue
        
        # Format average duration
        if valid_duration_count > 0:
            avg_seconds = total_duration_seconds / valid_duration_count
            minutes = int(avg_seconds // 60)
            seconds = int(avg_seconds % 60)
            avg_duration = f"{minutes}m {seconds}s"
        else:
            avg_duration = "N/A"
        
        print(f"Analytics for agent {agent_id}:")
        print(f"  Completed sessions: {len(completed_sessions)}")
        print(f"  Valid durations: {valid_duration_count}")
        print(f"  Avg duration: {avg_duration}")
        
        analytics = {
            'completed_sessions': len(completed_sessions),
            'total_fields': total_fields,
            'avg_duration': avg_duration,
        }
   
        
        return jsonify(analytics)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500