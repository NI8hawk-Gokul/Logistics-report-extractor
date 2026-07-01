import pandas as pd
import os

# Create directory
os.makedirs("test_sheets", exist_ok=True)

# 1. Operations test sheet
ops_data = [
    {
        "Job No": "JOB-101",
        "Date": "2026-06-10",
        "Client Name": "Acme Corp",
        "Agent Name": "John Agent",
        "Shipment Type": "FCL",
        "Status": "Completed",
        "Delay Reason": "",
        "Remarks": "Smooth delivery",
        "Billing Amount": 120000,
        "Expense": 90000,
        "Profit": 30000
    },
    {
        "Job No": "JOB-102",
        "Date": "2026-06-11",
        "Client Name": "Apex Industries",
        "Agent Name": "Sarah Agent",
        "Shipment Type": "LCL",
        "Status": "Pending",
        "Delay Reason": "Customs clearance delay",
        "Remarks": "Pending status",
        "Billing Amount": 80000,
        "Expense": 70000,
        "Profit": 10000
    }
]
pd.DataFrame(ops_data).to_excel("test_sheets/operations_test.xlsx", index=False)
pd.DataFrame(ops_data).to_csv("test_sheets/operations_test.csv", index=False)

# 2. Fleet test sheet
fleet_data = [
    {
        "Vehicle No": "TN-01-AX-1234",
        "Driver Name": "Rajesh Kumar",
        "Route": "Chennai-Bangalore",
        "Start KM": 12000,
        "End KM": 12350,
        "Fuel Used": 110,
        "Trip Date": "2026-06-12",
        "Delivery Status": "Delivered",
        "Maintenance Cost": 1500
    },
    {
        "Vehicle No": "TN-02-BY-5678",
        "Driver Name": "Amit Singh",
        "Route": "Mumbai-Pune",
        "Start KM": 45000,
        "End KM": 45180,
        "Fuel Used": 60,
        "Trip Date": "2026-06-13",
        "Delivery Status": "In Transit",
        "Maintenance Cost": 0
    }
]
pd.DataFrame(fleet_data).to_excel("test_sheets/fleet_test.xlsx", index=False)
pd.DataFrame(fleet_data).to_csv("test_sheets/fleet_test.csv", index=False)

# 3. HR test sheet
hr_data = [
    {
        "Employee ID": "EMP-001",
        "Employee Name": "Suresh Raina",
        "Department": "Operations",
        "Designation": "Coordinator",
        "Attendance": "Present",
        "Leave Days": 2,
        "Salary": 50000,
        "Joining Date": "2024-01-15"
      },
      {
        "Employee ID": "EMP-002",
        "Employee Name": "Priya Sharma",
        "Department": "Management",
        "Designation": "Lead Manager",
        "Attendance": "Present",
        "Leave Days": 0,
        "Salary": 95000,
        "Joining Date": "2023-06-01"
      }
]
pd.DataFrame(hr_data).to_excel("test_sheets/hr_test.xlsx", index=False)
pd.DataFrame(hr_data).to_csv("test_sheets/hr_test.csv", index=False)

print("Test sheets created successfully in test_sheets/")
