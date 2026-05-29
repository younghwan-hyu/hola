import json

data = {
    "status": "맑음",
    "highest_temperature": "25",
    "lowest_temperature": "20"
}

print(json.dumps(data, indent=4, ensure_ascii=False))
