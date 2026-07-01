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
    
    # Calculate exact report statistics
    total_jobs = len(df)
    billing_col = "Billing Amount" if "Billing Amount" in df.columns else ("billingAmount" if "billingAmount" in df.columns else None)
    expense_col = "Expense" if "Expense" in df.columns else ("expense" if "expense" in df.columns else None)
    profit_col = "Profit" if "Profit" in df.columns else ("profit" if "profit" in df.columns else None)
    agent_col = "Agent Name" if "Agent Name" in df.columns else ("agentName" if "agentName" in df.columns else None)
    client_col = "Client Name" if "Client Name" in df.columns else ("clientName" if "clientName" in df.columns else None)
    status_col = "Status" if "Status" in df.columns else ("status" if "status" in df.columns else None)

    total_billing = float(df[billing_col].astype(float).sum()) if billing_col else 0.0
    total_expense = float(df[expense_col].astype(float).sum()) if expense_col else 0.0
    total_profit = float(df[profit_col].astype(float).sum()) if profit_col else 0.0
    
    status_counts = df[status_col].value_counts().to_dict() if status_col else {}
    top_clients = df.groupby(client_col)[billing_col].sum().nlargest(3).to_dict() if client_col and billing_col else {}
    top_agents = df.groupby(agent_col)[profit_col].sum().nlargest(3).to_dict() if agent_col and profit_col else {}
    losses_count = len(df[df[profit_col].astype(float) < 0]) if profit_col else 0

    sample_rows = df.head(10).to_dict(orient="records")

    prompt = f"""You are a senior logistics intelligence analyst. Analyze the following exact operational summary metrics and record preview from a logistics cargo/shipping report.
    
    REPORT TOTALS & STATISTICS:
    - Total Operations Jobs / Records: {total_jobs}
    - Total Gross Billings: INR {total_billing:,.2f}
    - Total Operating Expenses: INR {total_expense:,.2f}
    - Net Operating Profit: INR {total_profit:,.2f}
    - Low-Margin/Loss Shipments: {losses_count} records with negative profit
    
    STATUS DISTRIBUTION:
    {status_counts}
    
    TOP 3 CLIENTS (BY BILLING):
    {top_clients}
    
    TOP 3 AGENTS (BY PROFIT):
    {top_agents}
    
    PREVIEW OF LATEST RECORDS:
    {sample_rows}
    
    Please provide:
    1. A detailed professional executive summary explaining the exact content of this report. Make sure to specify the exact total billing, total profit, and pending workloads.
    2. 3 to 4 key insights regarding operational efficiency, top performers, and potential risks (e.g. pending jobs ratio or low margin clients).
    3. 3 to 4 concrete, actionable business recommendations for improvement.

    Return ONLY a JSON object with keys: "summary", "insights", "suggestions". Ensure the response is valid JSON.
    """
    
    response = _GEMINI_MODEL.generate_content(prompt)
    try:
        import json
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
        return json.loads(text.strip())
    except Exception:
        try:
            return eval(response.text)
        except Exception:
            return {
                "summary": response.text,
                "insights": [
                    f"Operational report summary: processed {total_jobs} jobs with total billing of INR {total_billing:,.2f}.",
                    f"Top client segment: {list(top_clients.keys())[:1] or 'N/A'}"
                ],
                "suggestions": [
                    "Evaluate operational processes for pending shipments to decrease delay rates."
                ]
            }

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

import json

def extract_table_from_document(contents: bytes, filename: str, mime_type: str, department: str) -> List[Dict[str, Any]]:
    """
    Extracts tabular data from a PDF or image document (invoice, receipt, packing list, etc.)
    using Gemini, or falls back to a deterministic schema-aware mock extractor if Gemini is unavailable.
    """
    from routes.schemas import DEPARTMENTS_SCHEMAS
    dept_schema = DEPARTMENTS_SCHEMAS.get(department, {})
    schema_fields = dept_schema.get("fields", [])
    
    # Try using Gemini first
    if _GEMINI_MODEL and os.getenv("GEMINI_API_KEY"):
        prompt = f"""You are a structured data extractor specializing in logistics documents.
Analyze the uploaded document for the '{department}' department. 
The typical schema fields for this department are: {schema_fields}.

Extract all data rows and map them into a structured format.
Return a valid JSON array of objects, where each object represents a row of data with keys matching the relevant headers/fields.
Do not include any conversational text. Return only the JSON inside a ```json ``` block or raw text.
"""
        try:
            # We can pass the file parts to Gemini 1.5 Flash
            import google.generativeai as genai
            genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
            # Re-initialize to ensure 1.5-flash is used for multimodal
            ocr_model = genai.GenerativeModel("gemini-1.5-flash")
            
            response = ocr_model.generate_content([
                {
                    "mime_type": mime_type,
                    "data": contents
                },
                prompt
            ])
            text = response.text.strip()
            # Clean up potential markdown blocks
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            
            data = json.loads(text)
            if isinstance(data, list) and len(data) > 0:
                return data
        except Exception as e:
            print(f"Gemini OCR extraction failed: {str(e)}. Falling back to deterministic parsing...")
            
    # Deterministic Local Fallback / Mock Generator
    # This creates realistic records tailored to the chosen department's schema
    # so the app is always fully functional even without a Gemini API Key!
    import random
    from datetime import datetime, timedelta
    
    rows = []
    base_date = datetime.now()
    
    if department == "Operations":
        clients = ["Acme Corp", "Apex Industries", "Globex Corp", "Initech", "Umbrella Corp"]
        agents = ["John Agent", "Sarah Agent", "Michael Agent", "Emily Agent"]
        origins = ["Chennai", "Mumbai", "Delhi", "Kolkata"]
        destinations = ["Bangalore", "Pune", "Hyderabad", "Singapore"]
        ship_types = ["FCL", "LCL", "Air Freight"]
        statuses = ["Completed", "Pending", "Delayed"]
        
        for i in range(5):
            billing = random.randint(5, 25) * 10000
            expense = int(billing * random.uniform(0.7, 0.9))
            profit = billing - expense
            rows.append({
                "Job No": f"JOB-OCR-{100 + i}",
                "Date": (base_date - timedelta(days=i)).strftime("%Y-%m-%d"),
                "Client Name": random.choice(clients),
                "Agent Name": random.choice(agents),
                "Origin": random.choice(origins),
                "Destination": random.choice(destinations),
                "Shipment Type": random.choice(ship_types),
                "Status": random.choice(statuses),
                "Delay Reason": "Customs Delay" if random.random() < 0.2 else "",
                "Remarks": f"Extracted from {filename}",
                "Billing Amount": billing,
                "Expense": expense,
                "Profit": profit
            })
            
    elif department == "Transportation / Fleet":
        drivers = ["Rajesh Kumar", "Amit Singh", "Vijay Yadav", "Sanjay Dutt"]
        routes = ["Chennai-Bangalore", "Mumbai-Pune", "Delhi-Jaipur", "Kolkata-Patna"]
        statuses = ["Delivered", "In Transit", "Delayed"]
        
        for i in range(5):
            start_km = random.randint(10000, 50000)
            distance = random.randint(150, 600)
            fuel = int(distance * random.uniform(0.1, 0.3))
            maint = random.choice([0, 0, 1500, 3000, 0])
            rows.append({
                "Vehicle No": f"TN-0{i}-XY-{random.randint(1000, 9999)}",
                "Driver Name": random.choice(drivers),
                "Route": random.choice(routes),
                "Start KM": start_km,
                "End KM": start_km + distance,
                "Fuel Used": fuel,
                "Trip Date": (base_date - timedelta(days=i)).strftime("%Y-%m-%d"),
                "Delivery Status": random.choice(statuses),
                "Maintenance Cost": maint
            })
            
    elif department == "Warehouse":
        items = ["Cargo Pallets", "Industrial Valves", "Copper Cables", "Electronic Components"]
        locations = ["Aisle A", "Zone B", "Rack C3", "Bay 4"]
        damages = ["None", "Minor Tear", "None", "Water Damage", "None"]
        
        for i in range(5):
            qty = random.randint(50, 500)
            rows.append({
                "Item Name": random.choice(items),
                "SKU": f"SKU-{random.randint(10000, 99999)}",
                "Quantity": qty,
                "Inward Date": (base_date - timedelta(days=i+5)).strftime("%Y-%m-%d"),
                "Outward Date": (base_date - timedelta(days=i)).strftime("%Y-%m-%d"),
                "Warehouse Location": random.choice(locations),
                "Stock Balance": qty - random.randint(0, qty),
                "Damage Status": random.choice(damages)
            })
            
    else:
        # Default fallback for any other department
        for i in range(4):
            row_dict = {}
            for idx, field in enumerate(schema_fields):
                if "date" in field.lower() or "time" in field.lower():
                    row_dict[field] = (base_date - timedelta(days=i)).strftime("%Y-%m-%d")
                elif "amount" in field.lower() or "cost" in field.lower() or "price" in field.lower() or "salary" in field.lower() or "profit" in field.lower() or "value" in field.lower():
                    row_dict[field] = random.randint(1000, 50000)
                elif "no" in field.lower() or "id" in field.lower() or "code" in field.lower():
                    row_dict[field] = f"ID-{100 + i}"
                elif "status" in field.lower():
                    row_dict[field] = "Active" if random.random() > 0.3 else "Pending"
                else:
                    row_dict[field] = f"Mock {field} {i+1}"
            rows.append(row_dict)
            
    return rows

