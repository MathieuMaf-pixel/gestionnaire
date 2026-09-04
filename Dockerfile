FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --system --uid 10003 --create-home gestuser && mkdir -p /data && chown -R gestuser:gestuser /app /data
USER gestuser
VOLUME ["/data"]
EXPOSE 5000
CMD ["gunicorn", "-w", "2", "--threads", "4", "-b", "0.0.0.0:5000", "server:app"]
