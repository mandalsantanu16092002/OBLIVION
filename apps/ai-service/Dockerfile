FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/ai-service

COPY apps/ai-service/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY apps/ai-service/ ./
# training / evaluation scripts read the data pack
COPY data/ /srv/data/
ENV DATA_DIR=/srv/data \
    OUTPUT_DIR=/srv/output

# Re-train at build time so the image is reproducible from the data pack (models/ is also committed).
RUN python scripts/train.py

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /srv
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
