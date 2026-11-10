# Ohara's image: Python with Pillow (covers) and 7-Zip (to turn .cbr into .cbz).
# The code itself is mounted from the repo (see docker-compose.ohara.yml), so a
# git pull and a restart are enough to update it.
FROM python:3-alpine
RUN apk add --no-cache 7zip && pip install --no-cache-dir pillow
WORKDIR /app
CMD ["python", "-u", "ohara.py"]
