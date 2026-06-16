import copy
import os
import re
from dataclasses import dataclass
from typing import Any

import motor.motor_asyncio
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "logistics_report_db")
DATABASE_MODE = os.getenv("DATABASE_MODE", "auto").lower()


def _matches_condition(value: Any, condition: Any) -> bool:
    if not isinstance(condition, dict):
        return value == condition

    for operator, expected in condition.items():
        if operator == "$in" and value not in expected:
            return False
        if operator == "$ne" and value == expected:
            return False
        if operator == "$gte" and (value is None or value < expected):
            return False
        if operator == "$lte" and (value is None or value > expected):
            return False
        if operator == "$regex":
            flags = re.IGNORECASE if "i" in condition.get("$options", "") else 0
            if re.search(str(expected), str(value or ""), flags) is None:
                return False
        if operator == "$options":
            continue
    return True


def _matches_query(document: dict, query: dict) -> bool:
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches_query(document, item) for item in condition):
                return False
            continue
        if not _matches_condition(document.get(key), condition):
            return False
    return True


class MemoryCursor:
    def __init__(self, documents: list[dict]):
        self.documents = documents

    def sort(self, key: str, direction: int):
        reverse = direction < 0
        self.documents.sort(
            key=lambda document: (document.get(key) is None, document.get(key)),
            reverse=reverse,
        )
        return self

    def skip(self, count: int):
        self.documents = self.documents[count:]
        return self

    def limit(self, count: int):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int):
        return copy.deepcopy(self.documents[:length])


@dataclass
class MemoryInsertResult:
    inserted_id: ObjectId


class MemoryCollection:
    def __init__(self):
        self.documents: list[dict] = []

    async def find_one(self, query: dict):
        for document in self.documents:
            if _matches_query(document, query):
                return copy.deepcopy(document)
        return None

    def find(self, query: dict | None = None):
        query = query or {}
        matches = [
            copy.deepcopy(document)
            for document in self.documents
            if _matches_query(document, query)
        ]
        return MemoryCursor(matches)

    async def insert_one(self, document: dict):
        document.setdefault("_id", ObjectId())
        self.documents.append(copy.deepcopy(document))
        return MemoryInsertResult(document["_id"])

    async def insert_many(self, documents: list[dict]):
        inserted_ids = []
        for document in documents:
            result = await self.insert_one(document)
            inserted_ids.append(result.inserted_id)
        return inserted_ids

    async def update_one(self, query: dict, update: dict):
        for document in self.documents:
            if _matches_query(document, query):
                document.update(copy.deepcopy(update.get("$set", {})))
                break

    async def update_many(self, query: dict, update: dict):
        for document in self.documents:
            if _matches_query(document, query):
                document.update(copy.deepcopy(update.get("$set", {})))

    async def delete_one(self, query: dict):
        for index, document in enumerate(self.documents):
            if _matches_query(document, query):
                del self.documents[index]
                break

    async def delete_many(self, query: dict):
        self.documents = [
            document for document in self.documents if not _matches_query(document, query)
        ]

    async def count_documents(self, query: dict):
        return sum(1 for document in self.documents if _matches_query(document, query))

    def aggregate(self, pipeline: list[dict]):
        documents = copy.deepcopy(self.documents)
        for stage in pipeline:
            if "$match" in stage:
                documents = [
                    document
                    for document in documents
                    if _matches_query(document, stage["$match"])
                ]
            elif "$facet" in stage:
                facet_result = {}
                for facet_name, facet_stages in stage["$facet"].items():
                    facet_documents = copy.deepcopy(documents)
                    for facet_stage in facet_stages:
                        if "$group" in facet_stage:
                            field = facet_stage["$group"]["_id"].lstrip("$")
                            values = {
                                document.get(field)
                                for document in facet_documents
                            }
                            facet_documents = [{"_id": value} for value in values]
                        elif "$sort" in facet_stage:
                            key, direction = next(iter(facet_stage["$sort"].items()))
                            facet_documents.sort(
                                key=lambda document: (
                                    document.get(key) is None,
                                    document.get(key),
                                ),
                                reverse=direction < 0,
                            )
                    facet_result[facet_name] = facet_documents
                documents = [facet_result]
        return MemoryCursor(documents)


class MemoryDatabase:
    def __init__(self):
        self.collections: dict[str, MemoryCollection] = {}

    def __getitem__(self, name: str):
        if name not in self.collections:
            self.collections[name] = MemoryCollection()
        return self.collections[name]


def _mongo_is_available() -> bool:
    if DATABASE_MODE == "memory":
        return False
    probe = None
    try:
        probe = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1000)
        probe.admin.command("ping")
        return True
    except Exception:
        if DATABASE_MODE == "mongodb":
            raise
        return False
    finally:
        if probe is not None:
            probe.close()


if _mongo_is_available():
    client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URI)
    db = client[DATABASE_NAME]
    ACTIVE_DATABASE_MODE = "mongodb"
else:
    client = None
    db = MemoryDatabase()
    ACTIVE_DATABASE_MODE = "memory"

# Collections
users_collection = db["users"]
reports_collection = db["reports"]
report_versions_collection = db["report_versions"]
report_access_collection = db["report_access"]
report_templates_collection = db["report_templates"]
scheduled_reports_collection = db["scheduled_reports"]
activity_logs_collection = db["activity_logs"]
branches_collection = db["branches"]
departments_collection = db["departments"]
clients_collection = db["clients"]
agents_collection = db["agents"]
jobs_collection = db["jobs"]
payments_collection = db["payments"]
login_history_collection = db["login_history"]
login_otps_collection = db["login_otps"]
documents_collection = db["documents"]
approval_requests_collection = db["approval_requests"]
backups_collection = db["backups"]
system_settings_collection = db["system_settings"]
notifications_collection = db["notifications"]
data_validation_logs_collection = db["data_validation_logs"]
search_history_collection = db["search_history"]
api_integrations_collection = db["api_integrations"]


def get_database():
    return db
