Daily Energy & Grid News
- index.html shows headlines by reading data/top.json
- pull_news.py fetches & ranks news, writes data/top.json + data/linkedin.txt
- .github/workflows/daily.yml runs pull_news.py daily and commits outputs
