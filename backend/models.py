from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class LoginRequest(BaseModel):
    email: str
    password: str



class FilterRequest(BaseModel):
    agentName: List[str] = Field(default_factory=list)
    clientName: List[str] = Field(default_factory=list)
    jobType: List[str] = Field(default_factory=list)
    status: List[str] = Field(default_factory=list)
    dateRange: Dict[str, str] = Field(
        default_factory=lambda: {"fromDate": "", "toDate": ""}
    )
    profitRange: Dict[str, str] = Field(
        default_factory=lambda: {"minProfit": "", "maxProfit": ""}
    )
    billingRange: Dict[str, str] = Field(
        default_factory=lambda: {"minBilling": "", "maxBilling": ""}
    )
    searchText: str = ""
    reportId: str = ""

class ColumnMappingRequest(BaseModel):
    reportId: str
    mapping: Dict[str, str]

class SaveTemplateRequest(BaseModel):
    templateName: str
    filters: Dict[str, Any]

class ScheduledReportRequest(BaseModel):
    scheduleName: str
    templateId: str
    receiverEmail: str
    emailSubject: str
    emailMessage: str
    attachmentType: str
    frequency: str
    deliveryTime: str
    dayOfWeek: Optional[str] = None
    dayOfMonth: Optional[int] = None

class ReportAccessRequest(BaseModel):
    reportId: str
    assignedToType: str  # 'user' or 'role'
    assignedTo: str      # email or role name
    permissions: Dict[str, bool]

class ReportVersionRequest(BaseModel):
    reportName: str
    reportType: str
    period: str
    description: Optional[str] = ""


class BranchRequest(BaseModel):
    name: str
    code: str
    address: Optional[str] = ""


class DepartmentRequest(BaseModel):
    name: str
    code: str
    manager: Optional[str] = ""


class AIChatRequest(BaseModel):
    query: str
    reportId: Optional[str] = ""



class ClientRequest(BaseModel):
    name: str
    email: str
    phone: str
    address: Optional[str] = ""

class AgentRequest(BaseModel):
    name: str
    email: str
    phone: str
    branch: str

class JobRequest(BaseModel):
    jobNo: str
    clientName: str
    agentName: str
    jobType: str
    status: str
    billingAmount: float
    expense: float
    profit: float
    date: str
    branch: str
    department: str



class ShareReportEmailRequest(BaseModel):
    toEmail: str
    subject: str
    message: str
    attachmentType: str
    filters: Dict[str, Any]


class UserCreateRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str
    branch: Optional[str] = ""
    department: Optional[str] = ""


class PasswordChangeRequest(BaseModel):
    currentPassword: str
    newPassword: str


class SettingsUpdateRequest(BaseModel):
    settings: Dict[str, Any]


class IntegrationRequest(BaseModel):
    name: str
    integrationType: str
    baseUrl: str
    apiKey: Optional[str] = ""
    isActive: bool = True


class ApprovalCreateRequest(BaseModel):
    targetType: str
    targetId: str
    description: str
    amount: Optional[float] = None
