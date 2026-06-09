backend: cd backend && uvicorn app.main:app --reload --port 8000
worker: cd backend && celery -A app.tasks.celery_app worker -Q pingcha -c 4 -P solo --loglevel=info
pipeline: cd backend && celery -A app.tasks.celery_app worker -Q pingcha.pipeline -c 2 -P solo --loglevel=info
cron: cd backend && celery -A app.tasks.celery_app worker -Q pingcha.cron -c 1 -P solo --loglevel=info
curate: cd backend && celery -A app.tasks.celery_app worker -Q pingcha.curate -c 2 -P solo --loglevel=info
beat: cd backend && celery -A app.tasks.celery_app beat --loglevel=info
frontend: cd frontend && npm run dev -- --port 3000
