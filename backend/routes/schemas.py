from fastapi import APIRouter, Depends
from auth import get_current_user
from typing import Dict, Any

router = APIRouter(prefix="/reports", tags=["schemas"])

DEPARTMENTS_SCHEMAS = {
    "Operations": {
        "fields": ["Job No", "Date", "Client Name", "Agent Name", "Origin", "Destination", "Shipment Type", "Status", "Delay Reason", "Remarks", "Billing Amount", "Expense", "Profit"],
        "required": ["Job No", "Date"],
        "numeric": ["Billing Amount", "Expense", "Profit"],
        "date": ["Date"],
        "categorical": ["Status", "Shipment Type", "Agent Name", "Origin", "Destination"],
        "kpi": {
            "sum": ["Billing Amount", "Profit"],
            "count_label": "Total Jobs",
            "active_filter": {"field": "Status", "exclude": ["completed", "cancelled"]}
        }
    },
    "Transportation / Fleet": {
        "fields": ["Vehicle No", "Driver Name", "Route", "Start KM", "End KM", "Fuel Used", "Trip Date", "Delivery Status", "Maintenance Cost"],
        "required": ["Vehicle No", "Trip Date"],
        "numeric": ["Start KM", "End KM", "Fuel Used", "Maintenance Cost"],
        "date": ["Trip Date"],
        "categorical": ["Delivery Status", "Driver Name", "Route"],
        "kpi": {
            "sum": ["Fuel Used", "Maintenance Cost"],
            "count_label": "Total Trips",
            "active_filter": {"field": "Delivery Status", "exclude": ["delivered", "cancelled"]}
        }
    },
    "Warehouse": {
        "fields": ["Item Name", "SKU", "Quantity", "Inward Date", "Outward Date", "Warehouse Location", "Stock Balance", "Damage Status"],
        "required": ["Item Name", "Inward Date"],
        "numeric": ["Quantity", "Stock Balance"],
        "date": ["Inward Date", "Outward Date"],
        "categorical": ["Warehouse Location", "Damage Status"],
        "kpi": {
            "sum": ["Quantity"],
            "count_label": "Total Items",
            "active_filter": {"field": "Damage Status", "exclude": ["damaged"]}
        }
    },
    "Air Freight": {
        "fields": ["AWB No", "Airline Name", "Flight No", "Origin Airport", "Destination Airport", "Cargo Weight", "Freight Cost", "Status"],
        "required": ["AWB No", "Status"],
        "numeric": ["Cargo Weight", "Freight Cost"],
        "date": [],
        "categorical": ["Airline Name", "Origin Airport", "Destination Airport", "Status"],
        "kpi": {
            "sum": ["Cargo Weight", "Freight Cost"],
            "count_label": "Air Shipments",
            "active_filter": {"field": "Status", "exclude": ["delivered", "cancelled"]}
        }
    },
    "Customs Clearance": {
        "fields": ["BOE No", "Shipping Bill No", "Importer/Exporter Name", "HS Code", "Duty Amount", "Clearance Status", "Customs Date"],
        "required": ["BOE No", "Customs Date"],
        "numeric": ["Duty Amount"],
        "date": ["Customs Date"],
        "categorical": ["Clearance Status", "Importer/Exporter Name"],
        "kpi": {
            "sum": ["Duty Amount"],
            "count_label": "Total Clearance Bills",
            "active_filter": {"field": "Clearance Status", "exclude": ["cleared", "rejected"]}
        }
    },
    "Documentation": {
        "fields": ["Document Type", "Document No", "Client Name", "Job No", "Issue Date", "Expiry Date", "Status", "Verified By"],
        "required": ["Document No", "Issue Date"],
        "numeric": [],
        "date": ["Issue Date", "Expiry Date"],
        "categorical": ["Document Type", "Status", "Verified By"],
        "kpi": {
            "sum": [],
            "count_label": "Total Documents",
            "active_filter": {"field": "Status", "exclude": ["verified"]}
        }
    },
    "Sales & Marketing": {
        "fields": ["Lead Name", "Client Name", "Sales Executive", "Quotation Amount", "Follow-up Date", "Status", "Converted/Not Converted"],
        "required": ["Lead Name", "Follow-up Date"],
        "numeric": ["Quotation Amount"],
        "date": ["Follow-up Date"],
        "categorical": ["Sales Executive", "Status", "Converted/Not Converted"],
        "kpi": {
            "sum": ["Quotation Amount"],
            "count_label": "Total Leads",
            "active_filter": {"field": "Status", "exclude": ["won", "lost"]}
        }
    },
    "HR": {
        "fields": ["Employee ID", "Employee Name", "Department", "Designation", "Attendance", "Leave Days", "Salary", "Joining Date"],
        "required": ["Employee ID", "Employee Name"],
        "numeric": ["Leave Days", "Salary"],
        "date": ["Joining Date"],
        "categorical": ["Department", "Designation", "Attendance"],
        "kpi": {
            "sum": ["Salary"],
            "count_label": "Total Employees",
            "active_filter": {"field": "Attendance", "exclude": ["present", "wfh"]}
        }
    },
    "IT / Software": {
        "fields": ["User Name", "Role", "Login Time", "Action", "Module Name", "Error Type", "Backup Status", "IP Address"],
        "required": ["User Name", "Login Time"],
        "numeric": [],
        "date": ["Login Time"],
        "categorical": ["Role", "Action", "Module Name", "Error Type"],
        "kpi": {
            "sum": [],
            "count_label": "Total Logs",
            "active_filter": {"field": "Error Type", "exclude": ["None", ""]}
        }
    },
    "Compliance / Audit": {
        "fields": ["Audit ID", "Department", "Checked By", "Issue Found", "Risk Level", "Status", "Action Taken", "Audit Date"],
        "required": ["Audit ID", "Audit Date"],
        "numeric": [],
        "date": ["Audit Date"],
        "categorical": ["Department", "Risk Level", "Status"],
        "kpi": {
            "sum": [],
            "count_label": "Audit Checks",
            "active_filter": {"field": "Status", "exclude": ["passed"]}
        }
    },
    "Management / Admin": {
        "fields": ["Report Name", "Branch", "Department", "P&L Amount", "KPI Metric", "Status", "Pending Approvals"],
        "required": ["Report Name"],
        "numeric": ["P&L Amount", "Pending Approvals"],
        "date": [],
        "categorical": ["Branch", "Department", "Status"],
        "kpi": {
            "sum": ["P&L Amount", "Pending Approvals"],
            "count_label": "KPI Targets",
            "active_filter": {"field": "Status", "exclude": ["achieved"]}
        }
    }
}

@router.get("/schemas")
async def get_schemas(user: dict = Depends(get_current_user)):
    return DEPARTMENTS_SCHEMAS
