import pandas as pd
from typing import Dict, List, Any
import os

try:
    from google.generativeai import GenerativeModel
    _HAS_GEMINI = True
except ImportError:
    _HAS_GEMINI = False
    GenerativeModel = None

# Initialize Gemini model if API key is available and library is installed
_GEMINI_MODEL = None
if _HAS_GEMINI and os.getenv('GEMINI_API_KEY') and GenerativeModel:
    _GEMINI_MODEL = GenerativeModel('gemini-pro', api_key=os.getenv('GEMINI_API_KEY'))

def _gemini_analyze(df: pd.DataFrame) -> Dict[str, Any]:
    """Fallback LLM analysis using Gemini when available.
    Returns a structured JSON similar to generate_ai_insights.
    """
    if _GEMINI_MODEL is None:
        return {
            "summary": "Gemini API key not configured. Using deterministic insights.",
            "insights": [],
            "suggestions": []
        }
    # Build a concise prompt with a sample of data
    sample = df.head(5).to_csv(index=False)
    prompt = f"""You are a logistics analyst. Given the CSV data below, provide:
    1. A brief summary of the dataset.
    2. Key insights (e.g., top agents, profit margins, pending jobs).
    3. Recommendations for improvement.
    Respond in JSON format with keys: summary, insights, suggestions.

    CSV Data:\n{sample}"""
    response = _GEMINI_MODEL.generate_content(prompt)
    try:
        return eval(response.text)
    except Exception:
        return {"summary": response.text, "insights": [], "suggestions": []}

def generate_ai_insights(df: pd.DataFrame) -> Dict[str, Any]:
    """Generate insights either via deterministic logic or Gemini LLM.
    If Gemini is configured, it will be used for richer analysis.
    """
    if df.empty:
        return {
            "summary": "No shipping data is currently available in the database to compute AI insights.",
            "insights": ["No insights computed due to empty records database."],
            "suggestions": ["Upload a report to start receiving insights."]
        }
    # Prefer LLM when available
    if _GEMINI_MODEL:
        return _gemini_analyze(df)
    # Existing deterministic logic (unchanged) ...
    # NOTE: The original implementation follows after this point.

    if df.empty:
        return {
            "summary": "No shipping data is currently available in the database to compute AI insights.",
            "insights": ["No insights computed due to empty records database."],
            "suggestions": ["Upload a report to start receiving insights."]
        }
    
    total_jobs = len(df)
    
    # Check standard columns mapping
    billing_col = "Billing Amount" if "Billing Amount" in df.columns else "billingAmount"
    expense_col = "Expense" if "Expense" in df.columns else "expense"
    profit_col = "Profit" if "Profit" in df.columns else "profit"
    agent_col = "Agent Name" if "Agent Name" in df.columns else "agentName"
    client_col = "Client Name" if "Client Name" in df.columns else "clientName"
    status_col = "Status" if "Status" in df.columns else "status"

    # Normalize numeric columns before totals, grouping, and loss detection.
    df = df.copy()
    df[billing_col] = pd.to_numeric(df[billing_col], errors="coerce").fillna(0)
    df[expense_col] = pd.to_numeric(df[expense_col], errors="coerce").fillna(0)
    df[profit_col] = pd.to_numeric(df[profit_col], errors="coerce").fillna(0)

    total_billing = float(df[billing_col].sum())
    total_expense = float(df[expense_col].sum())
    total_profit = float(df[profit_col].sum())
    
    pending_df = df[df[status_col].astype(str).str.lower() == "pending"]
    pending_count = len(pending_df)
    pending_ratio = (pending_count / total_jobs) * 100 if total_jobs > 0 else 0
    
    # Grouping for top performers
    agent_group = df.groupby(agent_col)[profit_col].sum()
    top_agent = agent_group.idxmax() if not agent_group.empty else "N/A"
    top_agent_profit = float(agent_group.max()) if not agent_group.empty else 0.0
    
    client_group = df.groupby(client_col)[billing_col].sum()
    top_client = client_group.idxmax() if not client_group.empty else "N/A"
    top_client_billing = float(client_group.max()) if not client_group.empty else 0.0
    
    summary = (
        f"Smart Logistics Analytics processed a total of {total_jobs} shipping records. "
        f"Overall gross billing reached ₹{total_billing:,.2f} with net operating expenses at "
        f"₹{total_expense:,.2f}, yielding a cumulative profit of ₹{total_profit:,.2f}. "
        f"Our operations show {pending_count} pending jobs ({pending_ratio:.1f}% queue ratio). "
        f"The top-performing agent is {top_agent} (generating ₹{top_agent_profit:,.2f} profit) "
        f"and the largest client by invoice value is {top_client} (billing ₹{top_client_billing:,.2f})."
    )
    
    insights = []
    suggestions = []
    
    # 1. Margin evaluation
    margin = (total_profit / total_billing) * 100 if total_billing > 0 else 0
    if margin > 30:
        insights.append(f"Operating Margin: Excellent profit margin of {margin:.1f}%.")
    elif margin > 15:
        insights.append(f"Operating Margin: Healthy profit margin of {margin:.1f}%.")
    else:
        insights.append(f"Operating Margin: Low profit margin of {margin:.1f}%. Cost optimizations may be required.")
        suggestions.append("Perform a detailed audit on expense items to identify cost-saving opportunities.")
        
    # 2. Agent efficiency
    insights.append(f"Top Performer: Agent {top_agent} generated the highest profit of ₹{top_agent_profit:,.2f}.")
    
    # 3. Client billing concentration
    insights.append(f"Key Client: {top_client} is our highest-billing customer at ₹{top_client_billing:,.2f}.")
    
    # 4. Pending queue checks
    if pending_count > 0:
        insights.append(f"Operations: There are currently {pending_count} pending jobs waiting in the queue ({pending_ratio:.1f}% queue ratio).")
        if pending_ratio > 20:
            suggestions.append("Optimize resource allocation to clear the high ratio of pending delivery queues.")
    else:
        insights.append("Operations: All jobs are successfully completed or cleared.")

    # 5. Loss detection
    losses = df[df[profit_col] < 0]
    if not losses.empty:
        insights.append(f"Loss Alert: Found {len(losses)} shipments showing negative profit.")
        suggestions.append("Investigate shipment routes or client pricing models showing negative margins.")
        
    if not suggestions:
        suggestions.append("Continue monitoring key performance indicators (KPIs) to sustain operating growth.")
        
    return {
        "summary": summary,
        "insights": insights,
        "suggestions": suggestions
    }

def answer_ai_query(df: pd.DataFrame, query: str) -> str:
    # Deterministic NLP parser matching queries to pandas aggregates
    query = query.lower()
    
    billing_col = "Billing Amount" if "Billing Amount" in df.columns else "billingAmount"
    expense_col = "Expense" if "Expense" in df.columns else "expense"
    profit_col = "Profit" if "Profit" in df.columns else "profit"
    agent_col = "Agent Name" if "Agent Name" in df.columns else "agentName"
    client_col = "Client Name" if "Client Name" in df.columns else "clientName"
    status_col = "Status" if "Status" in df.columns else "status"

    if df.empty:
        return "No shipping records found in the database. Please upload a report version first."

    # Convert numeric columns
    df[billing_col] = pd.to_numeric(df[billing_col], errors='coerce').fillna(0)
    df[expense_col] = pd.to_numeric(df[expense_col], errors='coerce').fillna(0)
    df[profit_col] = pd.to_numeric(df[profit_col], errors='coerce').fillna(0)

    try:
        if "profit" in query:
            total_profit = df[profit_col].sum()
            if "agent" in query:
                agent_profit = df.groupby(agent_col)[profit_col].sum()
                top_agent = agent_profit.idxmax()
                return f"The top performing agent is {top_agent} with a total profit of ₹{agent_profit.max():,.2f}."
            if "branch" in query:
                branch_col = "branch" if "branch" in df.columns else "Branch"
                if branch_col in df.columns:
                    branch_profit = df.groupby(branch_col)[profit_col].sum()
                    top_branch = branch_profit.idxmax()
                    return f"The branch with the highest profit is {top_branch} (₹{branch_profit.max():,.2f} profit)."
            return f"The total profit computed from the active report is ₹{total_profit:,.2f}."

        elif "billing" in query or "revenue" in query:
            total_billing = df[billing_col].sum()
            if "client" in query:
                client_billing = df.groupby(client_col)[billing_col].sum()
                top_client = client_billing.idxmax()
                return f"The client with the highest billing is {top_client} with total invoices of ₹{client_billing.max():,.2f}."
            return f"The total billing amount computed from the active report is ₹{total_billing:,.2f}."

        elif "expense" in query or "cost" in query:
            total_expense = df[expense_col].sum()
            return f"The total operating expense computed from the active report is ₹{total_expense:,.2f}."

        elif "pending" in query or "job" in query or "status" in query:
            pending_count = len(df[df[status_col].astype(str).str.lower() == "pending"])
            completed_count = len(df[df[status_col].astype(str).str.lower() == "completed"])
            return f"Operations report: {len(df)} total jobs, {completed_count} completed, and {pending_count} pending."

        elif "mumbai" in query:
            branch_col = "branch" if "branch" in df.columns else "Branch"
            if branch_col in df.columns:
                mumbai_df = df[df[branch_col].astype(str).str.lower().str.contains("mumbai")]
                if not mumbai_df.empty:
                    m_jobs = len(mumbai_df)
                    m_profit = mumbai_df[profit_col].sum()
                    m_billing = mumbai_df[billing_col].sum()
                    return f"Mumbai Branch Summary: {m_jobs} jobs, ₹{m_billing:,.2f} total billing, yielding ₹{m_profit:,.2f} in net profit."
            return "No data found for Mumbai branch."

        # Fallback to general insights
        insights = generate_ai_insights(df)
        return insights["summary"]

    except Exception as e:
        return f"Sorry, I encountered an error translating your question to a database aggregation: {str(e)}"
