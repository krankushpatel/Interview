import pymongo

client = pymongo.MongoClient('mongodb://localhost:27017')
db = client['interview_platform']
db['users'].update_one(
    {'username': 'Ankush'}, 
    {'$set': {'is_terminated': False, 'termination_reason': '', 'attempts_taken': 0, 'max_attempts': 100}}
)
u = db['users'].find_one({'username': 'Ankush'})
print(f"Ankush is_terminated: {u.get('is_terminated')}, attempts: {u.get('attempts_taken')}/{u.get('max_attempts')}")
