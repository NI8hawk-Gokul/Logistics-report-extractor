import requests
import sys

BASE_URL = "http://127.0.0.1:8080"

# 1. Login
login_payload = {
    "email": "admin@logistics.com",
    "password": "admin123"
}
response = requests.post(f"{BASE_URL}/login", json=login_payload)
if response.status_code != 200:
    print("Login failed!", response.text)
    sys.exit(1)

token = response.json()["access_token"]
headers = {
    "Authorization": f"Bearer {token}"
}
print("Login successful. Token acquired.")

# Test schemas endpoint
schemas_res = requests.get(f"{BASE_URL}/reports/schemas", headers=headers)
if schemas_res.status_code != 200:
    print("Failed to fetch schemas!", schemas_res.text)
    sys.exit(1)
schemas = schemas_res.json()
print("Schemas fetched successfully. Supported departments:", list(schemas.keys()))

def upload_and_confirm(file_path, department, mapping, report_name):
    # Upload preview
    with open(file_path, 'rb') as f:
        files = {'file': (file_path.split('/')[-1], f, 'text/csv')}
        preview_res = requests.post(f"{BASE_URL}/upload-preview", files=files, headers=headers)
    
    if preview_res.status_code != 200:
        print(f"Preview upload failed for {file_path}!", preview_res.text)
        sys.exit(1)
        
    preview_data = preview_res.json()
    temp_id = preview_data["tempId"]
    print(f"Preview generated for {file_path}. TempID: {temp_id}")
    
    # Confirm mapping
    confirm_payload = {
        "tempId": temp_id,
        "mapping": mapping,
        "reportName": report_name,
        "reportType": "Monthly",
        "period": "June 2026",
        "description": f"Test upload for {department}",
        "department": department
    }
    confirm_res = requests.post(f"{BASE_URL}/confirm-column-mapping", json=confirm_payload, headers=headers)
    if confirm_res.status_code != 200:
        print(f"Confirmation failed for {department}!", confirm_res.text)
        sys.exit(1)
        
    confirm_data = confirm_res.json()
    print(f"Successfully confirmed mapping for {department}. ReportID: {confirm_data['reportId']}, Inserted rows: {confirm_data['insertedRows']}")
    return confirm_data['reportId']

# 2. Upload Operations
ops_mapping = {col: col for col in [
    "Job No", "Date", "Client Name", "Agent Name", "Shipment Type", "Status", "Delay Reason", "Remarks", "Billing Amount", "Expense", "Profit"
]}
ops_id = upload_and_confirm("test_sheets/operations_test.csv", "Operations", ops_mapping, "Operations June")

# 3. Upload Fleet
fleet_mapping = {col: col for col in [
    "Vehicle No", "Driver Name", "Route", "Start KM", "End KM", "Fuel Used", "Trip Date", "Delivery Status", "Maintenance Cost"
]}
fleet_id = upload_and_confirm("test_sheets/fleet_test.csv", "Transportation / Fleet", fleet_mapping, "Fleet June")

# 4. Upload HR
hr_mapping = {col: col for col in [
    "Employee ID", "Employee Name", "Department", "Designation", "Attendance", "Leave Days", "Salary", "Joining Date"
]}
hr_id = upload_and_confirm("test_sheets/hr_test.csv", "HR", hr_mapping, "HR June")

# 5. Query and Validate Filtered Report for each
def validate_report(report_id, department):
    payload = {
        "reportId": report_id,
        "page": 1,
        "pageSize": 10
    }
    filter_res = requests.post(f"{BASE_URL}/filter-report", json=payload, headers=headers)
    if filter_res.status_code != 200:
        print(f"Failed to filter report {report_id}!", filter_res.text)
        sys.exit(1)
        
    data = filter_res.json()
    print(f"\n--- Validation for {department} (Report ID: {report_id}) ---")
    print(f"Total records in DB: {data['total_records']}")
    if len(data['data']) > 0:
        record = data['data'][0]
        print("Keys present in record:")
        print(" - Original/CamelCase keys:", [k for k in record.keys() if k not in ["reportId", "uploadedBy", "uploadedAt", "branch", "department", "jobNo", "date", "clientName", "agentName", "jobType", "status", "billingAmount", "expense", "profit"]])
        print(" - Compatibility keys:")
        for comp_k in ["jobNo", "date", "clientName", "agentName", "jobType", "status", "billingAmount", "expense", "profit"]:
            print(f"   * {comp_k}: {record.get(comp_k)}")
    else:
        print("ERROR: No data records found!")
        sys.exit(1)

validate_report(ops_id, "Operations")
validate_report(fleet_id, "Transportation / Fleet")
validate_report(hr_id, "HR")

print("\nAll integration tests passed successfully!")
