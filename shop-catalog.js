'use strict';

/**
 * Shop Catalog — package definitions for VPS Control App Shop
 * ─────────────────────────────────────────────────────────────
 * Priority levels:
 *   essential    — must-have for almost every workflow
 *   recommended  — commonly useful
 *   optional     — niche but valuable
 *
 * persistent: true  → installs into /data (survives redeploy)
 * persistent: false → installs system-wide (lost on redeploy)
 */

function createCatalog({ PYLIB_DIR, NPM_DIR, BIN_DIR }) {
  const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";

  const PY  = pkg => `pip3 install --target=${PYLIB_DIR} --upgrade --no-cache-dir ${pkg}`;
  const NPM = pkg => `npm install -g --prefix=${NPM_DIR} --no-fund --no-audit ${pkg}`;
  const APT = pkgs => `apt-get update -qq && apt-get install -y --no-install-recommends ${pkgs}`;
  const BIN = (url, name) =>
    `cd /tmp && curl -fsSL ${q(url)} -o ${q(name)} && chmod +x ${q(name)} && mv ${q(name)} ${BIN_DIR}/`;

  return [

    /* ═══════════════════════════════════════════════════════════════════
       PYTHON — DATA & SCIENTIFIC
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'numpy', name: 'NumPy', category: 'python-data', color: '#013243',
      description: 'Fundamental package for scientific computing with multidimensional arrays.',
      size: '~20 MB', sizeBytes: 20971520, license: 'BSD-3-Clause',
      homepage: 'https://numpy.org', tags: ['arrays', 'math', 'scientific'],
      priority: 'essential', persistent: true,
      install: [PY('numpy')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import numpy; print(numpy.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/numpy ${PYLIB_DIR}/numpy-* ${PYLIB_DIR}/numpy.libs`]
    },
    {
      id: 'scipy', name: 'SciPy', category: 'python-data', color: '#8CAAE6',
      description: 'Scientific algorithms: optimization, integration, interpolation, signal processing.',
      size: '~40 MB', sizeBytes: 41943040, license: 'BSD-3-Clause',
      homepage: 'https://scipy.org', tags: ['scientific', 'optimization', 'signal'],
      priority: 'recommended', persistent: true,
      install: [PY('scipy')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import scipy; print(scipy.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/scipy ${PYLIB_DIR}/scipy-*`]
    },
    {
      id: 'pandas', name: 'Pandas', category: 'python-data', color: '#150458',
      description: 'Powerful data analysis and manipulation with DataFrames and Series.',
      size: '~50 MB', sizeBytes: 52428800, license: 'BSD-3-Clause',
      homepage: 'https://pandas.pydata.org', tags: ['dataframe', 'csv', 'analysis'],
      priority: 'essential', persistent: true,
      install: [PY('pandas')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import pandas; print(pandas.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pandas ${PYLIB_DIR}/pandas-* ${PYLIB_DIR}/pandas.libs`]
    },
    {
      id: 'polars', name: 'Polars', category: 'python-data', color: '#CD792C',
      description: 'Blazingly fast DataFrame library written in Rust. 10-30x faster than Pandas.',
      size: '~30 MB', sizeBytes: 31457280, license: 'MIT',
      homepage: 'https://pola.rs', tags: ['dataframe', 'fast', 'rust'],
      priority: 'recommended', persistent: true,
      install: [PY('polars')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import polars; print(polars.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/polars ${PYLIB_DIR}/polars-*`]
    },
    {
      id: 'duckdb', name: 'DuckDB', category: 'python-data', color: '#FFF000',
      description: 'In-process SQL OLAP database. Query CSV/Parquet files with SQL.',
      size: '~25 MB', sizeBytes: 26214400, license: 'MIT',
      homepage: 'https://duckdb.org', tags: ['sql', 'olap', 'analytics', 'parquet'],
      priority: 'essential', persistent: true,
      install: [PY('duckdb')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import duckdb; print(duckdb.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/duckdb ${PYLIB_DIR}/duckdb-*`]
    },
    {
      id: 'pyarrow', name: 'PyArrow', category: 'python-data', color: '#4A90D9',
      description: 'Apache Arrow columnar in-memory format. Fast Parquet and Feather I/O.',
      size: '~40 MB', sizeBytes: 41943040, license: 'Apache-2.0',
      homepage: 'https://arrow.apache.org', tags: ['parquet', 'columnar', 'arrow'],
      priority: 'optional', persistent: true,
      install: [PY('pyarrow')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import pyarrow; print(pyarrow.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pyarrow ${PYLIB_DIR}/pyarrow-*`]
    },
    {
      id: 'openpyxl', name: 'openpyxl', category: 'python-data', color: '#1D6F42',
      description: 'Read and write Excel 2010+ files (xlsx) without Excel installed.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://openpyxl.readthedocs.io', tags: ['excel', 'xlsx', 'spreadsheet'],
      priority: 'recommended', persistent: true,
      install: [PY('openpyxl')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import openpyxl; print(openpyxl.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/openpyxl ${PYLIB_DIR}/openpyxl-*`]
    },
    {
      id: 'matplotlib', name: 'Matplotlib', category: 'python-data', color: '#11557C',
      description: 'Publication-quality plotting. Uses Agg backend for headless servers.',
      size: '~30 MB', sizeBytes: 31457280, license: 'PSF',
      homepage: 'https://matplotlib.org', tags: ['plot', 'chart', 'visualization'],
      priority: 'recommended', persistent: true,
      install: [PY('matplotlib')],
      verify: `PYTHONPATH=${PYLIB_DIR} MPLBACKEND=Agg python3 -c "import matplotlib; print(matplotlib.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/matplotlib ${PYLIB_DIR}/matplotlib-* ${PYLIB_DIR}/mpl_toolkits`]
    },
    {
      id: 'seaborn', name: 'Seaborn', category: 'python-data', color: '#4C72B0',
      description: 'Statistical data visualization on top of Matplotlib.',
      size: '~5 MB', sizeBytes: 5242880, license: 'BSD-3-Clause',
      homepage: 'https://seaborn.pydata.org', tags: ['plot', 'statistics', 'visualization'],
      priority: 'optional', persistent: true,
      install: [PY('seaborn')],
      verify: `PYTHONPATH=${PYLIB_DIR} MPLBACKEND=Agg python3 -c "import seaborn; print(seaborn.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/seaborn ${PYLIB_DIR}/seaborn-*`]
    },
    {
      id: 'plotly', name: 'Plotly', category: 'python-data', color: '#3F4F75',
      description: 'Interactive charts that export to standalone HTML files.',
      size: '~10 MB', sizeBytes: 10485760, license: 'MIT',
      homepage: 'https://plotly.com/python', tags: ['plot', 'interactive', 'html'],
      priority: 'optional', persistent: true,
      install: [PY('plotly')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import plotly; print(plotly.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/plotly ${PYLIB_DIR}/plotly-*`]
    },
    {
      id: 'scikit-learn', name: 'scikit-learn', category: 'python-data', color: '#F7931E',
      description: 'Classic ML: regression, classification, clustering, dimensionality reduction.',
      size: '~40 MB', sizeBytes: 41943040, license: 'BSD-3-Clause',
      homepage: 'https://scikit-learn.org', tags: ['ml', 'regression', 'clustering'],
      priority: 'recommended', persistent: true,
      install: [PY('scikit-learn')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import sklearn; print(sklearn.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/sklearn ${PYLIB_DIR}/scikit_learn-*`]
    },
    {
      id: 'statsmodels', name: 'statsmodels', category: 'python-data', color: '#3B4B8C',
      description: 'Statistical models, hypothesis tests, and time-series analysis.',
      size: '~35 MB', sizeBytes: 36700160, license: 'BSD-3-Clause',
      homepage: 'https://statsmodels.org', tags: ['statistics', 'timeseries', 'econometrics'],
      priority: 'optional', persistent: true,
      install: [PY('statsmodels')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import statsmodels; print(statsmodels.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/statsmodels ${PYLIB_DIR}/statsmodels-*`]
    },
    {
      id: 'sympy', name: 'SymPy', category: 'python-data', color: '#3B5526',
      description: 'Symbolic mathematics — algebra, calculus, equation solving.',
      size: '~15 MB', sizeBytes: 15728640, license: 'BSD-3-Clause',
      homepage: 'https://sympy.org', tags: ['math', 'symbolic', 'algebra'],
      priority: 'optional', persistent: true,
      install: [PY('sympy')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import sympy; print(sympy.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/sympy ${PYLIB_DIR}/sympy-*`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       PYTHON — WEB & NETWORKING
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'requests', name: 'Requests', category: 'python-web', color: '#2C3E50',
      description: 'Elegant and simple HTTP library for Python.',
      size: '~500 KB', sizeBytes: 512000, license: 'Apache-2.0',
      homepage: 'https://requests.readthedocs.io', tags: ['http', 'client', 'rest'],
      priority: 'essential', persistent: true,
      install: [PY('requests')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import requests; print(requests.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/requests ${PYLIB_DIR}/requests-*`]
    },
    {
      id: 'httpx', name: 'HTTPX', category: 'python-web', color: '#4B8BBE',
      description: 'Modern HTTP client with async/await support and HTTP/2.',
      size: '~1 MB', sizeBytes: 1048576, license: 'BSD-3-Clause',
      homepage: 'https://www.python-httpx.org', tags: ['http', 'async', 'http2'],
      priority: 'recommended', persistent: true,
      install: [PY('httpx')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import httpx; print(httpx.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/httpx ${PYLIB_DIR}/httpx-*`]
    },
    {
      id: 'flask', name: 'Flask', category: 'python-web', color: '#000000',
      description: 'Lightweight WSGI micro-framework for web apps and APIs.',
      size: '~2 MB', sizeBytes: 2097152, license: 'BSD-3-Clause',
      homepage: 'https://flask.palletsprojects.com', tags: ['web', 'api', 'wsgi'],
      priority: 'recommended', persistent: true,
      install: [PY('flask')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import flask; print(flask.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/flask ${PYLIB_DIR}/Flask-* ${PYLIB_DIR}/jinja2 ${PYLIB_DIR}/werkzeug`]
    },
    {
      id: 'fastapi', name: 'FastAPI', category: 'python-web', color: '#009688',
      description: 'Modern, fast web framework with automatic OpenAPI docs.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://fastapi.tiangolo.com', tags: ['web', 'api', 'async', 'openapi'],
      priority: 'recommended', persistent: true,
      install: [PY('fastapi uvicorn[standard]')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import fastapi; print(fastapi.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/fastapi ${PYLIB_DIR}/uvicorn ${PYLIB_DIR}/starlette ${PYLIB_DIR}/fastapi-* ${PYLIB_DIR}/uvicorn-*`]
    },
    {
      id: 'gunicorn', name: 'Gunicorn', category: 'python-web', color: '#499848',
      description: 'Production WSGI server. Pre-fork worker model, battle-tested.',
      size: '~500 KB', sizeBytes: 512000, license: 'MIT',
      homepage: 'https://gunicorn.org', tags: ['server', 'wsgi', 'production'],
      priority: 'optional', persistent: true,
      install: [PY('gunicorn')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import gunicorn; print(gunicorn.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/gunicorn ${PYLIB_DIR}/gunicorn-*`]
    },
    {
      id: 'aiohttp', name: 'aiohttp', category: 'python-web', color: '#2C5BB4',
      description: 'Async HTTP client/server framework built on asyncio.',
      size: '~3 MB', sizeBytes: 3145728, license: 'Apache-2.0',
      homepage: 'https://docs.aiohttp.org', tags: ['http', 'async', 'server', 'client'],
      priority: 'optional', persistent: true,
      install: [PY('aiohttp')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import aiohttp; print(aiohttp.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/aiohttp ${PYLIB_DIR}/aiohttp-*`]
    },
    {
      id: 'websockets', name: 'websockets', category: 'python-web', color: '#00A0E9',
      description: 'WebSocket client and server implementation for Python.',
      size: '~1 MB', sizeBytes: 1048576, license: 'BSD-3-Clause',
      homepage: 'https://websockets.readthedocs.io', tags: ['websocket', 'async', 'realtime'],
      priority: 'optional', persistent: true,
      install: [PY('websockets')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import websockets; print(websockets.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/websockets ${PYLIB_DIR}/websockets-*`]
    },
    {
      id: 'jinja2', name: 'Jinja2', category: 'python-web', color: '#A51E22',
      description: 'Full-featured template engine for Python. Used by Flask, Ansible, etc.',
      size: '~500 KB', sizeBytes: 512000, license: 'BSD-3-Clause',
      homepage: 'https://jinja.palletsprojects.com', tags: ['template', 'html', 'render'],
      priority: 'optional', persistent: true,
      install: [PY('jinja2')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import jinja2; print(jinja2.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/jinja2 ${PYLIB_DIR}/Jinja2-*`]
    },
    {
      id: 'pydantic', name: 'Pydantic', category: 'python-web', color: '#E92063',
      description: 'Data validation using Python type hints. Fast, extensible.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://docs.pydantic.dev', tags: ['validation', 'types', 'schema'],
      priority: 'recommended', persistent: true,
      install: [PY('pydantic')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import pydantic; print(pydantic.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pydantic ${PYLIB_DIR}/pydantic_core ${PYLIB_DIR}/pydantic-*`]
    },
    {
      id: 'sqlalchemy', name: 'SQLAlchemy', category: 'python-web', color: '#D71F00',
      description: 'SQL toolkit and ORM. Supports SQLite, PostgreSQL, MySQL, and more.',
      size: '~10 MB', sizeBytes: 10485760, license: 'MIT',
      homepage: 'https://sqlalchemy.org', tags: ['orm', 'database', 'sql'],
      priority: 'recommended', persistent: true,
      install: [PY('sqlalchemy')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import sqlalchemy; print(sqlalchemy.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/sqlalchemy ${PYLIB_DIR}/SQLAlchemy-*`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       PYTHON — AUTOMATION & SCRAPING
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'beautifulsoup4', name: 'Beautiful Soup', category: 'python-auto', color: '#60A040',
      description: 'HTML and XML parser. Navigate, search, and modify parse trees.',
      size: '~500 KB', sizeBytes: 512000, license: 'MIT',
      homepage: 'https://www.crummy.com/software/BeautifulSoup',
      tags: ['html', 'scraping', 'parse'],
      priority: 'recommended', persistent: true,
      install: [PY('beautifulsoup4 lxml')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import bs4; print(bs4.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/bs4 ${PYLIB_DIR}/beautifulsoup4-*`]
    },
    {
      id: 'lxml', name: 'lxml', category: 'python-auto', color: '#3D9970',
      description: 'Fast XML and HTML parser with XPath and XSLT support.',
      size: '~5 MB', sizeBytes: 5242880, license: 'BSD-3-Clause',
      homepage: 'https://lxml.de', tags: ['xml', 'xpath', 'parser'],
      priority: 'recommended', persistent: true,
      install: [PY('lxml')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import lxml; print(lxml.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/lxml ${PYLIB_DIR}/lxml-*`]
    },
    {
      id: 'scrapy', name: 'Scrapy', category: 'python-auto', color: '#60A839',
      description: 'Fast high-level web crawling framework for structured scraping.',
      size: '~10 MB', sizeBytes: 10485760, license: 'BSD-3-Clause',
      homepage: 'https://scrapy.org', tags: ['scraping', 'crawl', 'spider'],
      priority: 'optional', persistent: true,
      install: [PY('scrapy')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import scrapy; print(scrapy.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/scrapy ${PYLIB_DIR}/Scrapy-*`]
    },
    {
      id: 'playwright', name: 'Playwright', category: 'python-auto', color: '#2EAD33',
      description: 'Browser automation. Chromium/Firefox/WebKit with sync and async API.',
      size: '~40 MB', sizeBytes: 41943040, license: 'Apache-2.0',
      homepage: 'https://playwright.dev/python', tags: ['browser', 'automation', 'scraping'],
      priority: 'optional', persistent: true,
      install: [
        PY('playwright'),
        `PYTHONPATH=${PYLIB_DIR} PLAYWRIGHT_BROWSERS_PATH=${PYLIB_DIR}/playwright-browsers python3 -m playwright install chromium --with-deps || true`
      ],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import playwright; print(playwright.__version__ if hasattr(playwright,'__version__') else 'installed')"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/playwright ${PYLIB_DIR}/playwright-* ${PYLIB_DIR}/playwright-browsers`]
    },
    {
      id: 'schedule', name: 'schedule', category: 'python-auto', color: '#4E7CBF',
      description: 'Human-friendly job scheduling in pure Python. No cron needed.',
      size: '~50 KB', sizeBytes: 51200, license: 'MIT',
      homepage: 'https://schedule.readthedocs.io', tags: ['cron', 'scheduler', 'timer'],
      priority: 'recommended', persistent: true,
      install: [PY('schedule')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import schedule; print(schedule.__version__ if hasattr(schedule,'__version__') else 'installed')"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/schedule ${PYLIB_DIR}/schedule-*`]
    },
    {
      id: 'watchdog', name: 'watchdog', category: 'python-auto', color: '#C7A252',
      description: 'Monitor filesystem events across platforms. Auto-reload on file change.',
      size: '~500 KB', sizeBytes: 512000, license: 'Apache-2.0',
      homepage: 'https://pythonhosted.org/watchdog', tags: ['filesystem', 'watch', 'events'],
      priority: 'optional', persistent: true,
      install: [PY('watchdog')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import watchdog; print(watchdog.version.VERSION_STRING)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/watchdog ${PYLIB_DIR}/watchdog-*`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       PYTHON — IMAGE / MEDIA
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'pillow', name: 'Pillow', category: 'python-media', color: '#3B3B3B',
      description: 'Python Imaging Library. Open, resize, crop, filter images.',
      size: '~5 MB', sizeBytes: 5242880, license: 'HPND',
      homepage: 'https://python-pillow.org', tags: ['image', 'pixel', 'convert'],
      priority: 'essential', persistent: true,
      install: [PY('pillow')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "from PIL import Image; print(Image.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/PIL ${PYLIB_DIR}/pillow* ${PYLIB_DIR}/Pillow-*`]
    },
    {
      id: 'opencv-python', name: 'OpenCV', category: 'python-media', color: '#5C3EE8',
      description: 'Computer vision library. Feature detection, image transform, video analysis.',
      size: '~60 MB', sizeBytes: 62914560, license: 'Apache-2.0',
      homepage: 'https://opencv.org', tags: ['cv', 'image', 'video', 'vision'],
      priority: 'optional', persistent: true,
      install: [PY('opencv-python-headless')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import cv2; print(cv2.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/cv2 ${PYLIB_DIR}/opencv_python* ${PYLIB_DIR}/opencv-python-*`]
    },
    {
      id: 'pypdf', name: 'pypdf', category: 'python-media', color: '#B30B00',
      description: 'Read, write, merge, split, and encrypt PDF files.',
      size: '~2 MB', sizeBytes: 2097152, license: 'BSD-3-Clause',
      homepage: 'https://pypdf.readthedocs.io', tags: ['pdf', 'merge', 'extract'],
      priority: 'recommended', persistent: true,
      install: [PY('pypdf')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import pypdf; print(pypdf.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pypdf ${PYLIB_DIR}/pypdf-*`]
    },
    {
      id: 'pdfplumber', name: 'pdfplumber', category: 'python-media', color: '#D32F2F',
      description: 'Extract text, tables, and metadata from PDF files with precise layout.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://github.com/jsvine/pdfplumber', tags: ['pdf', 'extract', 'tables'],
      priority: 'optional', persistent: true,
      install: [PY('pdfplumber')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import pdfplumber; print(pdfplumber.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pdfplumber ${PYLIB_DIR}/pdfplumber-*`]
    },
    {
      id: 'reportlab', name: 'ReportLab', category: 'python-media', color: '#E65100',
      description: 'Programmatic PDF generation with canvas and flowables.',
      size: '~3 MB', sizeBytes: 3145728, license: 'BSD-3-Clause',
      homepage: 'https://reportlab.com', tags: ['pdf', 'generate', 'canvas'],
      priority: 'optional', persistent: true,
      install: [PY('reportlab')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import reportlab; print(reportlab.Version)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/reportlab ${PYLIB_DIR}/reportlab-*`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       PYTHON — AI / ML / LLM
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'openai', name: 'OpenAI SDK', category: 'python-ai', color: '#10A37F',
      description: 'Official OpenAI Python SDK. GPT, DALL·E, Whisper, embeddings.',
      size: '~1 MB', sizeBytes: 1048576, license: 'Apache-2.0',
      homepage: 'https://platform.openai.com', tags: ['llm', 'gpt', 'api'],
      priority: 'recommended', persistent: true,
      install: [PY('openai')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import openai; print(openai.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/openai ${PYLIB_DIR}/openai-*`]
    },
    {
      id: 'anthropic', name: 'Anthropic SDK', category: 'python-ai', color: '#D4A27F',
      description: 'Official Anthropic SDK for Claude models.',
      size: '~1 MB', sizeBytes: 1048576, license: 'MIT',
      homepage: 'https://docs.anthropic.com', tags: ['llm', 'claude', 'api'],
      priority: 'recommended', persistent: true,
      install: [PY('anthropic')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import anthropic; print(anthropic.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/anthropic ${PYLIB_DIR}/anthropic-*`]
    },
    {
      id: 'google-genai', name: 'Google Generative AI', category: 'python-ai', color: '#4285F4',
      description: 'Official Google SDK for Gemini and PaLM models.',
      size: '~5 MB', sizeBytes: 5242880, license: 'Apache-2.0',
      homepage: 'https://ai.google.dev', tags: ['llm', 'gemini', 'api'],
      priority: 'optional', persistent: true,
      install: [PY('google-generativeai')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import google.generativeai; print('installed')"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/google ${PYLIB_DIR}/google_generativeai* ${PYLIB_DIR}/google-*`]
    },
    {
      id: 'sentence-transformers', name: 'Sentence Transformers', category: 'python-ai', color: '#FF6F61',
      description: 'State-of-the-art text embeddings. Requires PyTorch.',
      size: '~15 MB', sizeBytes: 15728640, license: 'Apache-2.0',
      homepage: 'https://sbert.net', tags: ['embedding', 'nlp', 'similarity'],
      priority: 'optional', persistent: true,
      install: [PY('sentence-transformers')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import sentence_transformers; print(sentence_transformers.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/sentence_transformers ${PYLIB_DIR}/sentence_transformers-*`]
    },
    {
      id: 'chromadb', name: 'ChromaDB', category: 'python-ai', color: '#FFB300',
      description: 'Embeddable vector database for AI applications. Persistent and fast.',
      size: '~50 MB', sizeBytes: 52428800, license: 'Apache-2.0',
      homepage: 'https://www.trychroma.com', tags: ['vector', 'embedding', 'rag'],
      priority: 'optional', persistent: true,
      install: [PY('chromadb')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import chromadb; print(chromadb.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/chromadb ${PYLIB_DIR}/chromadb-*`]
    },
    {
      id: 'tiktoken', name: 'tiktoken', category: 'python-ai', color: '#412991',
      description: 'Fast BPE tokenizer from OpenAI. Count tokens before sending to LLMs.',
      size: '~2 MB', sizeBytes: 2097152, license: 'MIT',
      homepage: 'https://github.com/openai/tiktoken', tags: ['tokenizer', 'llm', 'bpe'],
      priority: 'optional', persistent: true,
      install: [PY('tiktoken')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import tiktoken; print(tiktoken.__version__ if hasattr(tiktoken,'__version__') else 'installed')"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/tiktoken ${PYLIB_DIR}/tiktoken-*`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       NODE.JS — GLOBAL TOOLS
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'typescript', name: 'TypeScript', category: 'node', color: '#3178C6',
      description: 'TypeScript compiler (tsc). Typed superset of JavaScript.',
      size: '~30 MB', sizeBytes: 31457280, license: 'Apache-2.0',
      homepage: 'https://www.typescriptlang.org', tags: ['ts', 'compiler', 'types'],
      priority: 'essential', persistent: true,
      install: [NPM('typescript')],
      verify: `${NPM_DIR}/bin/tsc --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/typescript ${NPM_DIR}/bin/tsc ${NPM_DIR}/bin/tsserver`]
    },
    {
      id: 'ts-node', name: 'ts-node', category: 'node', color: '#2E6FA8',
      description: 'Run TypeScript directly without precompilation.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://typestrong.org/ts-node', tags: ['ts', 'runner', 'execute'],
      priority: 'recommended', persistent: true,
      install: [NPM('ts-node')],
      verify: `${NPM_DIR}/bin/ts-node --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/ts-node ${NPM_DIR}/bin/ts-node ${NPM_DIR}/bin/ts-script`]
    },
    {
      id: 'esbuild', name: 'esbuild', category: 'node', color: '#FFCF00',
      description: 'Extremely fast JavaScript/TypeScript bundler written in Go.',
      size: '~10 MB', sizeBytes: 10485760, license: 'MIT',
      homepage: 'https://esbuild.github.io', tags: ['bundler', 'fast', 'build'],
      priority: 'recommended', persistent: true,
      install: [NPM('esbuild')],
      verify: `${NPM_DIR}/bin/esbuild --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/esbuild ${NPM_DIR}/bin/esbuild`]
    },
    {
      id: 'vite', name: 'Vite', category: 'node', color: '#646CFF',
      description: 'Next-gen frontend build tool with instant HMR dev server.',
      size: '~15 MB', sizeBytes: 15728640, license: 'MIT',
      homepage: 'https://vitejs.dev', tags: ['bundler', 'dev-server', 'hmr'],
      priority: 'recommended', persistent: true,
      install: [NPM('vite')],
      verify: `${NPM_DIR}/bin/vite --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/vite ${NPM_DIR}/bin/vite`]
    },
    {
      id: 'pm2', name: 'PM2', category: 'node', color: '#2B037A',
      description: 'Production process manager with clustering, monitoring, and auto-restart.',
      size: '~5 MB', sizeBytes: 5242880, license: 'AGPL-3.0',
      homepage: 'https://pm2.keymetrics.io', tags: ['process', 'manager', 'cluster'],
      priority: 'essential', persistent: true,
      install: [NPM('pm2')],
      verify: `${NPM_DIR}/bin/pm2 --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/pm2 ${NPM_DIR}/bin/pm2 ${NPM_DIR}/bin/pm2-*`]
    },
    {
      id: 'nodemon', name: 'Nodemon', category: 'node', color: '#76D04B',
      description: 'Auto-restart Node.js applications when files change.',
      size: '~2 MB', sizeBytes: 2097152, license: 'MIT',
      homepage: 'https://nodemon.io', tags: ['dev', 'reload', 'watch'],
      priority: 'recommended', persistent: true,
      install: [NPM('nodemon')],
      verify: `${NPM_DIR}/bin/nodemon --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/nodemon ${NPM_DIR}/bin/nodemon`]
    },
    {
      id: 'pnpm', name: 'pnpm', category: 'node', color: '#F69220',
      description: 'Fast, disk space efficient package manager with strict dependency isolation.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://pnpm.io', tags: ['package', 'manager', 'fast'],
      priority: 'recommended', persistent: true,
      install: [NPM('pnpm')],
      verify: `${NPM_DIR}/bin/pnpm --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/pnpm ${NPM_DIR}/bin/pnpm`]
    },
    {
      id: 'prettier', name: 'Prettier', category: 'node', color: '#F7B93E',
      description: 'Opinionated code formatter for JS, TS, JSON, CSS, Markdown, and more.',
      size: '~10 MB', sizeBytes: 10485760, license: 'MIT',
      homepage: 'https://prettier.io', tags: ['format', 'lint', 'style'],
      priority: 'recommended', persistent: true,
      install: [NPM('prettier')],
      verify: `${NPM_DIR}/bin/prettier --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/prettier ${NPM_DIR}/bin/prettier`]
    },
    {
      id: 'eslint', name: 'ESLint', category: 'node', color: '#4B32C3',
      description: 'Pluggable linting utility for JavaScript and TypeScript.',
      size: '~15 MB', sizeBytes: 15728640, license: 'MIT',
      homepage: 'https://eslint.org', tags: ['lint', 'js', 'ts', 'quality'],
      priority: 'recommended', persistent: true,
      install: [NPM('eslint')],
      verify: `${NPM_DIR}/bin/eslint --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/eslint ${NPM_DIR}/bin/eslint`]
    },
    {
      id: 'http-server', name: 'http-server', category: 'node', color: '#2C3E50',
      description: 'Zero-config static file server. Great for local dev and previews.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/http-party/http-server', tags: ['static', 'server', 'preview'],
      priority: 'recommended', persistent: true,
      install: [NPM('http-server')],
      verify: `${NPM_DIR}/bin/http-server --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/http-server ${NPM_DIR}/bin/http-server ${NPM_DIR}/bin/hs`]
    },
    {
      id: 'serve', name: 'serve', category: 'node', color: '#000000',
      description: 'Static file serving with clean URLs and SPA fallback. Vercel-made.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/vercel/serve', tags: ['static', 'spa', 'server'],
      priority: 'optional', persistent: true,
      install: [NPM('serve')],
      verify: `${NPM_DIR}/bin/serve --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/serve ${NPM_DIR}/bin/serve`]
    },
    {
      id: 'json-server', name: 'json-server', category: 'node', color: '#3E7BFA',
      description: 'Instant REST API from a JSON file. Perfect for prototypes.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://github.com/typicode/json-server', tags: ['mock', 'api', 'prototype'],
      priority: 'optional', persistent: true,
      install: [NPM('json-server')],
      verify: `${NPM_DIR}/bin/json-server --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/json-server ${NPM_DIR}/bin/json-server`]
    },
    {
      id: 'concurrently', name: 'concurrently', category: 'node', color: '#2C3E50',
      description: 'Run multiple npm scripts in parallel with prefixed output.',
      size: '~2 MB', sizeBytes: 2097152, license: 'MIT',
      homepage: 'https://github.com/open-cli-tools/concurrently', tags: ['parallel', 'scripts', 'dev'],
      priority: 'optional', persistent: true,
      install: [NPM('concurrently')],
      verify: `${NPM_DIR}/bin/concurrently --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/concurrently ${NPM_DIR}/bin/concurrently`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       RUNTIMES — ALTERNATIVE LANGUAGES
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'bun', name: 'Bun', category: 'runtime', color: '#FBF0DF',
      description: 'All-in-one JS runtime with built-in bundler, test runner, and package manager.',
      size: '~80 MB', sizeBytes: 83886080, license: 'MIT',
      homepage: 'https://bun.sh', tags: ['js', 'runtime', 'fast'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://bun.sh/install | bash -s "bun-v1.1.30" 2>&1 | tail -5`,
        `ln -sf $HOME/.bun/bin/bun ${BIN_DIR}/bun && ln -sf $HOME/.bun/bin/bunx ${BIN_DIR}/bunx`
      ],
      verify: `${BIN_DIR}/bun --version`,
      uninstall: [`rm -rf $HOME/.bun`, `rm -f ${BIN_DIR}/bun ${BIN_DIR}/bunx`]
    },
    {
      id: 'rust', name: 'Rust Toolchain', category: 'runtime', color: '#CE422B',
      description: 'Rust compiler, cargo, and rustup. ~400 MB after first install.',
      size: '~400 MB', sizeBytes: 419430400, license: 'MIT/Apache-2.0',
      homepage: 'https://rustup.rs', tags: ['rust', 'cargo', 'compiler'],
      priority: 'optional', persistent: true,
      install: [
        `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | CARGO_HOME=/data/cargo RUSTUP_HOME=/data/rustup sh -s -- -y --no-modify-path --default-toolchain stable --profile minimal`,
        `ln -sf /data/cargo/bin/cargo ${BIN_DIR}/cargo && ln -sf /data/cargo/bin/rustc ${BIN_DIR}/rustc && ln -sf /data/cargo/bin/rustup ${BIN_DIR}/rustup`
      ],
      verify: `${BIN_DIR}/cargo --version`,
      uninstall: [`rm -rf /data/cargo /data/rustup`, `rm -f ${BIN_DIR}/cargo ${BIN_DIR}/rustc ${BIN_DIR}/rustup ${BIN_DIR}/rustdoc`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       CLI TOOLS — MODERN UTILITIES
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'ripgrep', name: 'ripgrep', category: 'cli', color: '#D3450B',
      description: 'Blazingly fast recursive search that respects .gitignore.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/BurntSushi/ripgrep', tags: ['grep', 'search', 'fast'],
      priority: 'essential', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv ripgrep-14.1.1-x86_64-unknown-linux-musl/rg ${BIN_DIR}/rg && chmod +x ${BIN_DIR}/rg`
      ],
      verify: `${BIN_DIR}/rg --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/rg`]
    },
    {
      id: 'fd', name: 'fd', category: 'cli', color: '#D3450B',
      description: 'Simple, fast alternative to find with sensible defaults.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/sharkdp/fd', tags: ['find', 'search', 'files'],
      priority: 'essential', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/sharkdp/fd/releases/download/v10.2.0/fd-v10.2.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv fd-v10.2.0-x86_64-unknown-linux-musl/fd ${BIN_DIR}/fd && chmod +x ${BIN_DIR}/fd`
      ],
      verify: `${BIN_DIR}/fd --version`,
      uninstall: [`rm -f ${BIN_DIR}/fd`]
    },
    {
      id: 'bat', name: 'bat', category: 'cli', color: '#6B46C1',
      description: 'cat clone with syntax highlighting, line numbers, and Git integration.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT/Apache-2.0',
      homepage: 'https://github.com/sharkdp/bat', tags: ['cat', 'syntax', 'highlight'],
      priority: 'essential', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv bat-v0.24.0-x86_64-unknown-linux-musl/bat ${BIN_DIR}/bat && chmod +x ${BIN_DIR}/bat`
      ],
      verify: `${BIN_DIR}/bat --version`,
      uninstall: [`rm -f ${BIN_DIR}/bat`]
    },
    {
      id: 'fzf', name: 'fzf', category: 'cli', color: '#0073B7',
      description: 'Command-line fuzzy finder. Works with anything that outputs lines.',
      size: '~2 MB', sizeBytes: 2097152, license: 'MIT',
      homepage: 'https://github.com/junegunn/fzf', tags: ['fuzzy', 'finder', 'interactive'],
      priority: 'essential', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/junegunn/fzf/releases/download/v0.55.0/fzf-0.55.0-linux_amd64.tar.gz | tar -xz -C ${BIN_DIR} && chmod +x ${BIN_DIR}/fzf`
      ],
      verify: `${BIN_DIR}/fzf --version`,
      uninstall: [`rm -f ${BIN_DIR}/fzf`]
    },
    {
      id: 'eza', name: 'eza', category: 'cli', color: '#4E9A06',
      description: 'Modern ls replacement with icons, colors, and Git status.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/eza-community/eza', tags: ['ls', 'listing', 'icons'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/eza-community/eza/releases/download/v0.20.4/eza_x86_64-unknown-linux-gnu.tar.gz | tar -xz && mv eza ${BIN_DIR}/eza && chmod +x ${BIN_DIR}/eza`
      ],
      verify: `${BIN_DIR}/eza --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/eza`]
    },
    {
      id: 'zoxide', name: 'zoxide', category: 'cli', color: '#4CAF50',
      description: 'Smarter cd command that learns your most-used directories.',
      size: '~2 MB', sizeBytes: 2097152, license: 'MIT',
      homepage: 'https://github.com/ajeetdsouza/zoxide', tags: ['cd', 'navigation', 'shell'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/ajeetdsouza/zoxide/releases/download/v0.9.6/zoxide-0.9.6-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv zoxide ${BIN_DIR}/zoxide && chmod +x ${BIN_DIR}/zoxide`
      ],
      verify: `${BIN_DIR}/zoxide --version`,
      uninstall: [`rm -f ${BIN_DIR}/zoxide`]
    },
    {
      id: 'delta', name: 'delta', category: 'cli', color: '#F2743B',
      description: 'Syntax-highlighting pager for git diff and grep output.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://github.com/dandavison/delta', tags: ['git', 'diff', 'highlight'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/dandavison/delta/releases/download/0.18.2/delta-0.18.2-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv delta-0.18.2-x86_64-unknown-linux-musl/delta ${BIN_DIR}/delta && chmod +x ${BIN_DIR}/delta`
      ],
      verify: `${BIN_DIR}/delta --version`,
      uninstall: [`rm -f ${BIN_DIR}/delta`]
    },
    {
      id: 'dust', name: 'dust', category: 'cli', color: '#8B5A2B',
      description: 'More intuitive version of du — visualized disk usage tree.',
      size: '~3 MB', sizeBytes: 3145728, license: 'Apache-2.0',
      homepage: 'https://github.com/bootandy/dust', tags: ['disk', 'usage', 'tree'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/bootandy/dust/releases/download/v1.1.1/dust-v1.1.1-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv dust-v1.1.1-x86_64-unknown-linux-musl/dust ${BIN_DIR}/dust && chmod +x ${BIN_DIR}/dust`
      ],
      verify: `${BIN_DIR}/dust --version`,
      uninstall: [`rm -f ${BIN_DIR}/dust`]
    },
    {
      id: 'procs', name: 'procs', category: 'cli', color: '#4A90D9',
      description: 'Modern ps replacement with colors and tree view.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/dalance/procs', tags: ['ps', 'process', 'monitor'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/dalance/procs/releases/download/v0.14.6/procs-v0.14.6-x86_64-linux.zip -o procs.zip && unzip -q procs.zip -d procs-dir && mv procs-dir/procs ${BIN_DIR}/procs && chmod +x ${BIN_DIR}/procs`
      ],
      verify: `${BIN_DIR}/procs --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/procs`]
    },
    {
      id: 'bottom', name: 'bottom (btm)', category: 'cli', color: '#4A90D9',
      description: 'Cross-platform graphical process monitor with charts.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://clementtsang.github.io/bottom', tags: ['htop', 'monitor', 'chart'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/ClementTsang/bottom/releases/download/0.10.2/bottom_x86_64-unknown-linux-musl.tar.gz | tar -xz && mv btm ${BIN_DIR}/btm && chmod +x ${BIN_DIR}/btm`
      ],
      verify: `${BIN_DIR}/btm --version`,
      uninstall: [`rm -f ${BIN_DIR}/btm`]
    },
    {
      id: 'tokei', name: 'tokei', category: 'cli', color: '#2E86C1',
      description: 'Count lines of code by language with fast parallel processing.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/XAMPPRocky/tokei', tags: ['loc', 'count', 'stats'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/XAMPPRocky/tokei/releases/download/v13.0.0-alpha.8/tokei-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv tokei ${BIN_DIR}/tokei && chmod +x ${BIN_DIR}/tokei`
      ],
      verify: `${BIN_DIR}/tokei --version`,
      uninstall: [`rm -f ${BIN_DIR}/tokei`]
    },
    {
      id: 'glow', name: 'glow', category: 'cli', color: '#5A3DBA',
      description: 'Render Markdown in the terminal with style.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://github.com/charmbracelet/glow', tags: ['markdown', 'render', 'reader'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/charmbracelet/glow/releases/download/v2.0.0/glow_2.0.0_Linux_x86_64.tar.gz | tar -xz && mv glow ${BIN_DIR}/glow && chmod +x ${BIN_DIR}/glow`
      ],
      verify: `${BIN_DIR}/glow --version`,
      uninstall: [`rm -f ${BIN_DIR}/glow`]
    },
    {
      id: 'sd', name: 'sd', category: 'cli', color: '#2C3E50',
      description: 'Intuitive sed replacement with clearer regex syntax.',
      size: '~2 MB', sizeBytes: 2097152, license: 'MIT',
      homepage: 'https://github.com/chmln/sd', tags: ['sed', 'replace', 'regex'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/chmln/sd/releases/download/v1.0.0/sd-v1.0.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv sd-v1.0.0-x86_64-unknown-linux-musl/sd ${BIN_DIR}/sd && chmod +x ${BIN_DIR}/sd`
      ],
      verify: `${BIN_DIR}/sd --version`,
      uninstall: [`rm -f ${BIN_DIR}/sd`]
    },
    {
      id: 'hyperfine', name: 'hyperfine', category: 'cli', color: '#2C3E50',
      description: 'Command-line benchmarking tool with statistical analysis.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT/Apache-2.0',
      homepage: 'https://github.com/sharkdp/hyperfine', tags: ['benchmark', 'timing', 'perf'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/sharkdp/hyperfine/releases/download/v1.19.0/hyperfine-v1.19.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv hyperfine-v1.19.0-x86_64-unknown-linux-musl/hyperfine ${BIN_DIR}/hyperfine && chmod +x ${BIN_DIR}/hyperfine`
      ],
      verify: `${BIN_DIR}/hyperfine --version`,
      uninstall: [`rm -f ${BIN_DIR}/hyperfine`]
    },
    {
      id: 'jq', name: 'jq', category: 'cli', color: '#2F855A',
      description: 'Lightweight and flexible command-line JSON processor.',
      size: '~500 KB', sizeBytes: 512000, license: 'MIT',
      homepage: 'https://jqlang.github.io/jq', tags: ['json', 'parse', 'filter'],
      priority: 'essential', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64 -o jq && chmod +x jq && mv jq ${BIN_DIR}/jq`
      ],
      verify: `${BIN_DIR}/jq --version`,
      uninstall: [`rm -f ${BIN_DIR}/jq`]
    },
    {
      id: 'yq', name: 'yq', category: 'cli', color: '#4A90D9',
      description: 'jq for YAML, TOML, XML, and JSON with in-place editing.',
      size: '~8 MB', sizeBytes: 8388608, license: 'MIT',
      homepage: 'https://github.com/mikefarah/yq', tags: ['yaml', 'parse', 'filter'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 -o yq && chmod +x yq && mv yq ${BIN_DIR}/yq`
      ],
      verify: `${BIN_DIR}/yq --version`,
      uninstall: [`rm -f ${BIN_DIR}/yq`]
    },
    {
      id: 'shellcheck', name: 'shellcheck', category: 'cli', color: '#2C5BB4',
      description: 'Static analysis tool for shell scripts. Catches real bugs.',
      size: '~5 MB', sizeBytes: 5242880, license: 'GPL-3.0',
      homepage: 'https://shellcheck.net', tags: ['shell', 'lint', 'bash'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck-v0.10.0.linux.x86_64.tar.xz | tar -xJ && mv shellcheck-v0.10.0/shellcheck ${BIN_DIR}/shellcheck && chmod +x ${BIN_DIR}/shellcheck`
      ],
      verify: `${BIN_DIR}/shellcheck --version | grep version:`,
      uninstall: [`rm -f ${BIN_DIR}/shellcheck`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       SYSTEM UTILITIES
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'htop', name: 'htop', category: 'system', color: '#0078D4',
      description: 'Interactive process viewer with color and mouse support.',
      size: '~300 KB', sizeBytes: 307200, license: 'GPL-2.0',
      homepage: 'https://htop.dev', tags: ['process', 'monitor', 'top'],
      priority: 'essential', persistent: false,
      install: [APT('htop')],
      verify: 'htop --version | head -n1',
      uninstall: [`apt-get remove -y htop && apt-get autoremove -y`]
    },
    {
      id: 'tree', name: 'tree', category: 'system', color: '#2F855A',
      description: 'Recursive directory listing in indented tree format.',
      size: '~100 KB', sizeBytes: 102400, license: 'GPL-2.0',
      homepage: 'http://mama.indstate.edu/users/ice/tree', tags: ['directory', 'listing', 'tree'],
      priority: 'recommended', persistent: false,
      install: [APT('tree')],
      verify: 'tree --version | head -n1',
      uninstall: [`apt-get remove -y tree && apt-get autoremove -y`]
    },
    {
      id: 'ncdu', name: 'ncdu', category: 'system', color: '#4A90D9',
      description: 'Interactive disk usage analyzer with TUI.',
      size: '~500 KB', sizeBytes: 512000, license: 'MIT',
      homepage: 'https://dev.yorhel.nl/ncdu', tags: ['disk', 'usage', 'analyzer'],
      priority: 'recommended', persistent: false,
      install: [APT('ncdu')],
      verify: 'ncdu --version | head -n1',
      uninstall: [`apt-get remove -y ncdu && apt-get autoremove -y`]
    },
    {
      id: 'rclone', name: 'rclone', category: 'system', color: '#4CAF50',
      description: 'Sync files with 40+ cloud storage providers (S3, Drive, Dropbox, etc).',
      size: '~20 MB', sizeBytes: 20971520, license: 'MIT',
      homepage: 'https://rclone.org', tags: ['cloud', 'sync', 'backup', 's3'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o rclone.zip && unzip -q rclone.zip && mv rclone-*-linux-amd64/rclone ${BIN_DIR}/rclone && chmod +x ${BIN_DIR}/rclone`
      ],
      verify: `${BIN_DIR}/rclone version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/rclone`]
    },
    {
      id: 'rsync', name: 'rsync', category: 'system', color: '#2E86C1',
      description: 'Fast incremental file transfer with delta algorithm.',
      size: '~500 KB', sizeBytes: 512000, license: 'GPL-3.0',
      homepage: 'https://rsync.samba.org', tags: ['sync', 'transfer', 'backup'],
      priority: 'recommended', persistent: false,
      install: [APT('rsync')],
      verify: 'rsync --version | head -n1',
      uninstall: [`apt-get remove -y rsync && apt-get autoremove -y`]
    },
    {
      id: 'iotop', name: 'iotop', category: 'system', color: '#E65100',
      description: 'Monitor disk I/O usage by process in real-time.',
      size: '~100 KB', sizeBytes: 102400, license: 'GPL-2.0',
      homepage: 'http://guichaz.free.fr/iotop', tags: ['disk', 'io', 'monitor'],
      priority: 'optional', persistent: false,
      install: [APT('iotop')],
      verify: 'iotop --version | head -n1',
      uninstall: [`apt-get remove -y iotop && apt-get autoremove -y`]
    },
    {
      id: 'sysstat', name: 'sysstat', category: 'system', color: '#2C3E50',
      description: 'Performance monitoring: sar, iostat, mpstat, pidstat.',
      size: '~2 MB', sizeBytes: 2097152, license: 'GPL-2.0',
      homepage: 'http://sebastien.godard.pagesperso-orange.fr',
      tags: ['monitor', 'perf', 'stats', 'iostat'],
      priority: 'recommended', persistent: false,
      install: [APT('sysstat')],
      verify: 'iostat -V 2>&1 | head -n1',
      uninstall: [`apt-get remove -y sysstat && apt-get autoremove -y`]
    },
    {
      id: 'lsof', name: 'lsof', category: 'system', color: '#2C3E50',
      description: 'List open files and the processes using them.',
      size: '~500 KB', sizeBytes: 512000, license: 'lsof',
      homepage: 'https://github.com/lsof-org/lsof', tags: ['files', 'process', 'debug'],
      priority: 'recommended', persistent: false,
      install: [APT('lsof')],
      verify: 'lsof -v 2>&1 | head -n2 | tail -n1',
      uninstall: [`apt-get remove -y lsof && apt-get autoremove -y`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       NETWORK TOOLS
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'nmap', name: 'nmap', category: 'network', color: '#4A90D9',
      description: 'Network exploration and security auditing. Port scanner.',
      size: '~5 MB', sizeBytes: 5242880, license: 'GPL-2.0',
      homepage: 'https://nmap.org', tags: ['scan', 'port', 'network'],
      priority: 'optional', persistent: false,
      install: [APT('nmap')],
      verify: 'nmap --version | head -n1',
      uninstall: [`apt-get remove -y nmap && apt-get autoremove -y`]
    },
    {
      id: 'netcat', name: 'netcat', category: 'network', color: '#2C3E50',
      description: 'TCP/IP swiss army knife for reading and writing network connections.',
      size: '~100 KB', sizeBytes: 102400, license: 'GPL-2.0',
      homepage: 'https://netcat.sourceforge.net', tags: ['tcp', 'udp', 'socket'],
      priority: 'recommended', persistent: false,
      install: [APT('netcat-openbsd')],
      verify: 'nc -h 2>&1 | head -n1',
      uninstall: [`apt-get remove -y netcat-openbsd && apt-get autoremove -y`]
    },
    {
      id: 'socat', name: 'socat', category: 'network', color: '#4A90D9',
      description: 'Multipurpose relay for bidirectional data transfer between sockets.',
      size: '~300 KB', sizeBytes: 307200, license: 'GPL-2.0',
      homepage: 'http://www.dest-unreach.org/socat', tags: ['socket', 'relay', 'tunnel'],
      priority: 'optional', persistent: false,
      install: [APT('socat')],
      verify: 'socat -V 2>&1 | head -n1',
      uninstall: [`apt-get remove -y socat && apt-get autoremove -y`]
    },
    {
      id: 'mtr', name: 'mtr', category: 'network', color: '#2E86C1',
      description: 'Combined traceroute and ping in a single interactive tool.',
      size: '~200 KB', sizeBytes: 204800, license: 'GPL-2.0',
      homepage: 'https://www.bitwizard.nl/mtr', tags: ['traceroute', 'ping', 'latency'],
      priority: 'optional', persistent: false,
      install: [APT('mtr-tiny')],
      verify: 'mtr --version 2>&1 | head -n1',
      uninstall: [`apt-get remove -y mtr-tiny && apt-get autoremove -y`]
    },
    {
      id: 'httpie', name: 'HTTPie (CLI)', category: 'network', color: '#73DC8C',
      description: 'User-friendly HTTP client. curl for humans with JSON support.',
      size: '~5 MB', sizeBytes: 5242880, license: 'BSD-3-Clause',
      homepage: 'https://httpie.io', tags: ['http', 'api', 'client'],
      priority: 'recommended', persistent: true,
      install: [PY('httpie')],
      verify: `${PYLIB_DIR}/bin/http --version 2>&1 | head -n1 || PYTHONPATH=${PYLIB_DIR} python3 -m httpie --version | head -n1`,
      uninstall: [`rm -rf ${PYLIB_DIR}/httpie ${PYLIB_DIR}/httpie-* ${PYLIB_DIR}/bin/http`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       SECURITY
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'gnupg', name: 'GnuPG', category: 'security', color: '#0071BC',
      description: 'OpenPGP encryption and signing tool.',
      size: '~5 MB', sizeBytes: 5242880, license: 'GPL-3.0',
      homepage: 'https://gnupg.org', tags: ['gpg', 'pgp', 'crypto', 'sign'],
      priority: 'recommended', persistent: false,
      install: [APT('gnupg')],
      verify: 'gpg --version | head -n1',
      uninstall: [`apt-get remove -y gnupg && apt-get autoremove -y`]
    },
    {
      id: 'age', name: 'age', category: 'security', color: '#4A90D9',
      description: 'Modern, simple file encryption with sensible defaults.',
      size: '~3 MB', sizeBytes: 3145728, license: 'BSD-3-Clause',
      homepage: 'https://age-encryption.org', tags: ['encryption', 'crypto', 'simple'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/FiloSottile/age/releases/download/v1.2.0/age-v1.2.0-linux-amd64.tar.gz | tar -xz && mv age/age ${BIN_DIR}/age && mv age/age-keygen ${BIN_DIR}/age-keygen && chmod +x ${BIN_DIR}/age ${BIN_DIR}/age-keygen`
      ],
      verify: `${BIN_DIR}/age --version`,
      uninstall: [`rm -f ${BIN_DIR}/age ${BIN_DIR}/age-keygen`]
    },
    {
      id: 'trivy', name: 'Trivy', category: 'security', color: '#1904DA',
      description: 'Comprehensive vulnerability scanner for containers and filesystems.',
      size: '~50 MB', sizeBytes: 52428800, license: 'Apache-2.0',
      homepage: 'https://trivy.dev', tags: ['security', 'scan', 'vulnerability'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/aquasecurity/trivy/releases/download/v0.57.1/trivy_0.57.1_Linux-64bit.tar.gz | tar -xz && mv trivy ${BIN_DIR}/trivy && chmod +x ${BIN_DIR}/trivy`
      ],
      verify: `${BIN_DIR}/trivy --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/trivy`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       DATABASES — CLIENT TOOLS
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'sqlite3', name: 'SQLite CLI', category: 'db', color: '#003B57',
      description: 'Command-line interface for SQLite databases.',
      size: '~500 KB', sizeBytes: 512000, license: 'Public Domain',
      homepage: 'https://sqlite.org', tags: ['sqlite', 'sql', 'embedded'],
      priority: 'essential', persistent: false,
      install: [APT('sqlite3')],
      verify: 'sqlite3 --version',
      uninstall: [`apt-get remove -y sqlite3 && apt-get autoremove -y`]
    },
    {
      id: 'postgresql-client', name: 'PostgreSQL Client', category: 'db', color: '#336791',
      description: 'psql command-line client for PostgreSQL databases.',
      size: '~10 MB', sizeBytes: 10485760, license: 'PostgreSQL',
      homepage: 'https://www.postgresql.org', tags: ['postgres', 'psql', 'sql'],
      priority: 'recommended', persistent: false,
      install: [APT('postgresql-client')],
      verify: 'psql --version',
      uninstall: [`apt-get remove -y postgresql-client && apt-get autoremove -y`]
    },
    {
      id: 'mysql-client', name: 'MySQL Client', category: 'db', color: '#4479A1',
      description: 'mysql command-line client for MySQL and MariaDB.',
      size: '~5 MB', sizeBytes: 5242880, license: 'GPL-2.0',
      homepage: 'https://dev.mysql.com', tags: ['mysql', 'mariadb', 'sql'],
      priority: 'recommended', persistent: false,
      install: [APT('default-mysql-client')],
      verify: 'mysql --version',
      uninstall: [`apt-get remove -y default-mysql-client && apt-get autoremove -y`]
    },
    {
      id: 'redis-tools', name: 'Redis CLI', category: 'db', color: '#DC382D',
      description: 'redis-cli client for Redis databases.',
      size: '~2 MB', sizeBytes: 2097152, license: 'BSD-3-Clause',
      homepage: 'https://redis.io', tags: ['redis', 'cache', 'kv'],
      priority: 'recommended', persistent: false,
      install: [APT('redis-tools')],
      verify: 'redis-cli --version',
      uninstall: [`apt-get remove -y redis-tools && apt-get autoremove -y`]
    },
    {
      id: 'pgcli', name: 'pgcli', category: 'db', color: '#336791',
      description: 'PostgreSQL CLI with autocompletion and syntax highlighting.',
      size: '~10 MB', sizeBytes: 10485760, license: 'BSD-3-Clause',
      homepage: 'https://www.pgcli.com', tags: ['postgres', 'autocomplete', 'cli'],
      priority: 'optional', persistent: true,
      install: [PY('pgcli')],
      verify: `PYTHONPATH=${PYLIB_DIR} ${PYLIB_DIR}/bin/pgcli --version 2>&1 | head -n1`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pgcli ${PYLIB_DIR}/pgcli-* ${PYLIB_DIR}/bin/pgcli`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       MEDIA PROCESSING
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'ffmpeg', name: 'FFmpeg', category: 'media', color: '#007808',
      description: 'Complete multimedia framework for audio/video conversion and streaming.',
      size: '~80 MB', sizeBytes: 83886080, license: 'LGPL/GPL',
      homepage: 'https://ffmpeg.org', tags: ['video', 'audio', 'convert', 'transcode'],
      priority: 'recommended', persistent: false,
      install: [APT('ffmpeg')],
      verify: 'ffmpeg -version | head -n1',
      uninstall: [`apt-get remove -y ffmpeg && apt-get autoremove -y`]
    },
    {
      id: 'imagemagick', name: 'ImageMagick', category: 'media', color: '#4B0082',
      description: 'Image manipulation suite. Convert, resize, crop, compose.',
      size: '~20 MB', sizeBytes: 20971520, license: 'ImageMagick',
      homepage: 'https://imagemagick.org', tags: ['image', 'convert', 'resize'],
      priority: 'recommended', persistent: false,
      install: [APT('imagemagick')],
      verify: 'convert --version | head -n1',
      uninstall: [`apt-get remove -y imagemagick && apt-get autoremove -y`]
    },
    {
      id: 'exiftool', name: 'ExifTool', category: 'media', color: '#2C3E50',
      description: 'Read and write metadata in images, video, and PDF files.',
      size: '~10 MB', sizeBytes: 10485760, license: 'Perl Artistic',
      homepage: 'https://exiftool.org', tags: ['metadata', 'exif', 'image'],
      priority: 'optional', persistent: false,
      install: [APT('libimage-exiftool-perl')],
      verify: 'exiftool -ver',
      uninstall: [`apt-get remove -y libimage-exiftool-perl && apt-get autoremove -y`]
    },
    {
      id: 'pngquant', name: 'pngquant', category: 'media', color: '#3E6E9C',
      description: 'Lossy PNG compressor. Reduce file size 60-80% with minimal quality loss.',
      size: '~500 KB', sizeBytes: 512000, license: 'GPL-3.0',
      homepage: 'https://pngquant.org', tags: ['png', 'compress', 'optimize'],
      priority: 'optional', persistent: false,
      install: [APT('pngquant')],
      verify: 'pngquant --version',
      uninstall: [`apt-get remove -y pngquant && apt-get autoremove -y`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       DOCUMENT / TEXT
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'pandoc', name: 'Pandoc', category: 'text', color: '#3498DB',
      description: 'Universal document converter. 40+ formats: Markdown, HTML, DOCX, PDF.',
      size: '~30 MB', sizeBytes: 31457280, license: 'GPL-2.0',
      homepage: 'https://pandoc.org', tags: ['convert', 'markdown', 'docx', 'pdf'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/jgm/pandoc/releases/download/3.4/pandoc-3.4-linux-amd64.tar.gz | tar -xz && mv pandoc-3.4/bin/pandoc ${BIN_DIR}/pandoc && chmod +x ${BIN_DIR}/pandoc`
      ],
      verify: `${BIN_DIR}/pandoc --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/pandoc`]
    },
    {
      id: 'poppler-utils', name: 'Poppler Utils', category: 'text', color: '#D32F2F',
      description: 'PDF utilities: pdftotext, pdftoppm, pdfinfo, pdfimages.',
      size: '~5 MB', sizeBytes: 5242880, license: 'GPL-2.0',
      homepage: 'https://poppler.freedesktop.org', tags: ['pdf', 'extract', 'convert'],
      priority: 'recommended', persistent: false,
      install: [APT('poppler-utils')],
      verify: 'pdfinfo -v 2>&1 | head -n1',
      uninstall: [`apt-get remove -y poppler-utils && apt-get autoremove -y`]
    },
    {
      id: 'tesseract-ocr', name: 'Tesseract OCR', category: 'text', color: '#2E86C1',
      description: 'Optical character recognition engine. Extract text from images.',
      size: '~15 MB', sizeBytes: 15728640, license: 'Apache-2.0',
      homepage: 'https://github.com/tesseract-ocr/tesseract', tags: ['ocr', 'text', 'image'],
      priority: 'optional', persistent: false,
      install: [APT('tesseract-ocr')],
      verify: 'tesseract --version 2>&1 | head -n1',
      uninstall: [`apt-get remove -y tesseract-ocr && apt-get autoremove -y`]
    },
    {
      id: 'qpdf', name: 'qpdf', category: 'text', color: '#C0392B',
      description: 'Structural PDF transformation: merge, split, linearize, encrypt.',
      size: '~3 MB', sizeBytes: 3145728, license: 'Apache-2.0',
      homepage: 'https://qpdf.readthedocs.io', tags: ['pdf', 'merge', 'split'],
      priority: 'optional', persistent: false,
      install: [APT('qpdf')],
      verify: 'qpdf --version | head -n1',
      uninstall: [`apt-get remove -y qpdf && apt-get autoremove -y`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       ARCHIVE / COMPRESSION
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'p7zip', name: 'p7zip-full', category: 'archive', color: '#2C3E50',
      description: '7-Zip command-line. Extract most archive formats.',
      size: '~3 MB', sizeBytes: 3145728, license: 'LGPL',
      homepage: 'https://7-zip.org', tags: ['7z', 'zip', 'extract'],
      priority: 'essential', persistent: false,
      install: [APT('p7zip-full')],
      verify: '7z | head -n2 | tail -n1',
      uninstall: [`apt-get remove -y p7zip-full && apt-get autoremove -y`]
    },
    {
      id: 'unrar', name: 'unrar', category: 'archive', color: '#2C3E50',
      description: 'Extract RAR archives. Freeware license.',
      size: '~300 KB', sizeBytes: 307200, license: 'Freeware',
      homepage: 'https://www.rarlab.com', tags: ['rar', 'extract'],
      priority: 'recommended', persistent: false,
      install: [`${APT('unrar-free')} || true`, `${APT('unrar')} || true`],
      verify: 'unrar --version 2>&1 | head -n1 || unrar-free --version 2>&1 | head -n1',
      uninstall: [`apt-get remove -y unrar unrar-free && apt-get autoremove -y`]
    },
    {
      id: 'zstd', name: 'zstd', category: 'archive', color: '#3E7BFA',
      description: 'Fast lossless compression. 5x faster than gzip at similar ratio.',
      size: '~1 MB', sizeBytes: 1048576, license: 'BSD-3-Clause',
      homepage: 'https://facebook.github.io/zstd', tags: ['compress', 'fast', 'zstd'],
      priority: 'recommended', persistent: false,
      install: [APT('zstd')],
      verify: 'zstd --version | head -n1',
      uninstall: [`apt-get remove -y zstd && apt-get autoremove -y`]
    },
    {
      id: 'pigz', name: 'pigz', category: 'archive', color: '#2C3E50',
      description: 'Parallel gzip — uses multiple cores for compression.',
      size: '~500 KB', sizeBytes: 512000, license: 'Zlib',
      homepage: 'https://zlib.net/pigz', tags: ['gzip', 'parallel', 'compress'],
      priority: 'optional', persistent: false,
      install: [APT('pigz')],
      verify: 'pigz --version 2>&1 | head -n1',
      uninstall: [`apt-get remove -y pigz && apt-get autoremove -y`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       BUILD TOOLS
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'cmake', name: 'CMake', category: 'build', color: '#064F8C',
      description: 'Cross-platform build system generator.',
      size: '~20 MB', sizeBytes: 20971520, license: 'BSD-3-Clause',
      homepage: 'https://cmake.org', tags: ['build', 'make', 'c++'],
      priority: 'recommended', persistent: false,
      install: [APT('cmake')],
      verify: 'cmake --version | head -n1',
      uninstall: [`apt-get remove -y cmake && apt-get autoremove -y`]
    },
    {
      id: 'ninja', name: 'Ninja', category: 'build', color: '#2C3E50',
      description: 'Small, fast build system focused on speed.',
      size: '~500 KB', sizeBytes: 512000, license: 'Apache-2.0',
      homepage: 'https://ninja-build.org', tags: ['build', 'fast', 'ninja'],
      priority: 'recommended', persistent: false,
      install: [APT('ninja-build')],
      verify: 'ninja --version',
      uninstall: [`apt-get remove -y ninja-build && apt-get autoremove -y`]
    },
    {
      id: 'gdb', name: 'GDB', category: 'build', color: '#2C3E50',
      description: 'GNU Debugger for C, C++, Go, Rust, and more.',
      size: '~10 MB', sizeBytes: 10485760, license: 'GPL-3.0',
      homepage: 'https://www.gnu.org/software/gdb', tags: ['debug', 'gdb', 'trace'],
      priority: 'optional', persistent: false,
      install: [APT('gdb')],
      verify: 'gdb --version | head -n1',
      uninstall: [`apt-get remove -y gdb && apt-get autoremove -y`]
    },
    {
      id: 'strace', name: 'strace', category: 'build', color: '#2C3E50',
      description: 'Trace system calls and signals of a running process.',
      size: '~500 KB', sizeBytes: 512000, license: 'BSD',
      homepage: 'https://strace.io', tags: ['trace', 'syscall', 'debug'],
      priority: 'optional', persistent: false,
      install: [APT('strace')],
      verify: 'strace -V | head -n1',
      uninstall: [`apt-get remove -y strace && apt-get autoremove -y`]
    },
    {
      id: 'valgrind', name: 'Valgrind', category: 'build', color: '#2C3E50',
      description: 'Memory error detector and profiler for C/C++.',
      size: '~50 MB', sizeBytes: 52428800, license: 'GPL-2.0',
      homepage: 'https://valgrind.org', tags: ['memory', 'leak', 'debug'],
      priority: 'optional', persistent: false,
      install: [APT('valgrind')],
      verify: 'valgrind --version',
      uninstall: [`apt-get remove -y valgrind && apt-get autoremove -y`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       CLOUD CLIs
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'gh', name: 'GitHub CLI', category: 'cloud', color: '#181717',
      description: 'Official GitHub CLI. Manage repos, PRs, issues, releases.',
      size: '~20 MB', sizeBytes: 20971520, license: 'MIT',
      homepage: 'https://cli.github.com', tags: ['github', 'git', 'pr'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/cli/cli/releases/download/v2.60.0/gh_2.60.0_linux_amd64.tar.gz | tar -xz && mv gh_2.60.0_linux_amd64/bin/gh ${BIN_DIR}/gh && chmod +x ${BIN_DIR}/gh`
      ],
      verify: `${BIN_DIR}/gh --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/gh`]
    },
    {
      id: 'railway', name: 'Railway CLI', category: 'cloud', color: '#0B0D0E',
      description: 'Deploy and manage apps on Railway from the terminal.',
      size: '~40 MB', sizeBytes: 41943040, license: 'MIT',
      homepage: 'https://railway.app', tags: ['railway', 'deploy', 'paas'],
      priority: 'essential', persistent: true,
      install: [NPM('@railway/cli')],
      verify: `${NPM_DIR}/bin/railway --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/@railway ${NPM_DIR}/bin/railway`]
    },
    {
      id: 'vercel', name: 'Vercel CLI', category: 'cloud', color: '#000000',
      description: 'Deploy frontend projects to Vercel edge network.',
      size: '~30 MB', sizeBytes: 31457280, license: 'Apache-2.0',
      homepage: 'https://vercel.com', tags: ['vercel', 'deploy', 'frontend'],
      priority: 'optional', persistent: true,
      install: [NPM('vercel')],
      verify: `${NPM_DIR}/bin/vercel --version`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/vercel ${NPM_DIR}/bin/vercel`]
    },
    {
      id: 'netlify-cli', name: 'Netlify CLI', category: 'cloud', color: '#00C7B7',
      description: 'Deploy static sites and serverless functions to Netlify.',
      size: '~50 MB', sizeBytes: 52428800, license: 'MIT',
      homepage: 'https://netlify.com', tags: ['netlify', 'deploy', 'jamstack'],
      priority: 'optional', persistent: true,
      install: [NPM('netlify-cli')],
      verify: `${NPM_DIR}/bin/netlify --version | head -n1`,
      uninstall: [`rm -rf ${NPM_DIR}/lib/node_modules/netlify-cli ${NPM_DIR}/bin/netlify ${NPM_DIR}/bin/ntl`]
    },
    {
      id: 'aws-cli', name: 'AWS CLI', category: 'cloud', color: '#FF9900',
      description: 'Official Amazon Web Services command-line interface.',
      size: '~50 MB', sizeBytes: 52428800, license: 'Apache-2.0',
      homepage: 'https://aws.amazon.com/cli', tags: ['aws', 'cloud', 's3', 'ec2'],
      priority: 'optional', persistent: true,
      install: [PY('awscli')],
      verify: `PYTHONPATH=${PYLIB_DIR} ${PYLIB_DIR}/bin/aws --version 2>&1 | head -n1`,
      uninstall: [`rm -rf ${PYLIB_DIR}/awscli ${PYLIB_DIR}/awscli-* ${PYLIB_DIR}/bin/aws`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       EDITORS
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'neovim', name: 'Neovim', category: 'editor', color: '#57A143',
      description: 'Hyperextensible Vim-based text editor with Lua scripting.',
      size: '~30 MB', sizeBytes: 31457280, license: 'Apache-2.0',
      homepage: 'https://neovim.io', tags: ['editor', 'vim', 'lua'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/neovim/neovim/releases/download/v0.10.2/nvim-linux64.tar.gz | tar -xz && mv nvim-linux64/bin/nvim ${BIN_DIR}/nvim && chmod +x ${BIN_DIR}/nvim`
      ],
      verify: `${BIN_DIR}/nvim --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/nvim`]
    },
    {
      id: 'micro', name: 'micro', category: 'editor', color: '#2ECC71',
      description: 'Modern terminal editor. Intuitive like nano but powerful like vim.',
      size: '~10 MB', sizeBytes: 10485760, license: 'MIT',
      homepage: 'https://micro-editor.github.io', tags: ['editor', 'nano', 'terminal'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/zyedidia/micro/releases/download/v2.0.14/micro-2.0.14-linux64.tar.gz | tar -xz && mv micro-2.0.14/micro ${BIN_DIR}/micro && chmod +x ${BIN_DIR}/micro`
      ],
      verify: `${BIN_DIR}/micro --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/micro`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       TERMINAL ENHANCEMENT
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'starship', name: 'Starship', category: 'terminal', color: '#DD0B78',
      description: 'Minimal, blazing-fast, customizable prompt for any shell.',
      size: '~5 MB', sizeBytes: 5242880, license: 'ISC',
      homepage: 'https://starship.rs', tags: ['prompt', 'shell', 'theme'],
      priority: 'recommended', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/starship/starship/releases/download/v1.21.1/starship-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv starship ${BIN_DIR}/starship && chmod +x ${BIN_DIR}/starship`
      ],
      verify: `${BIN_DIR}/starship --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/starship`]
    },
    {
      id: 'zsh', name: 'Zsh', category: 'terminal', color: '#2C3E50',
      description: 'Powerful shell with extensive plugin ecosystem.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT-like',
      homepage: 'https://zsh.org', tags: ['shell', 'zsh', 'terminal'],
      priority: 'optional', persistent: false,
      install: [APT('zsh')],
      verify: 'zsh --version',
      uninstall: [`apt-get remove -y zsh && apt-get autoremove -y`]
    },
    {
      id: 'fish', name: 'Fish Shell', category: 'terminal', color: '#4A90D9',
      description: 'Friendly interactive shell with autosuggestions and syntax highlighting.',
      size: '~5 MB', sizeBytes: 5242880, license: 'GPL-2.0',
      homepage: 'https://fishshell.com', tags: ['shell', 'fish', 'friendly'],
      priority: 'optional', persistent: false,
      install: [APT('fish')],
      verify: 'fish --version',
      uninstall: [`apt-get remove -y fish && apt-get autoremove -y`]
    },
    {
      id: 'tmux-extra', name: 'tmux-resurrect', category: 'terminal', color: '#1BB91F',
      description: 'Save and restore tmux sessions across restarts. Plugin for tmux.',
      size: '~100 KB', sizeBytes: 102400, license: 'MIT',
      homepage: 'https://github.com/tmux-plugins/tmux-resurrect',
      tags: ['tmux', 'session', 'restore'],
      priority: 'optional', persistent: true,
      install: [
        `mkdir -p /data/tmux/plugins && cd /data/tmux/plugins && git clone https://github.com/tmux-plugins/tmux-resurrect.git 2>/dev/null || (cd tmux-resurrect && git pull)`
      ],
      verify: `test -d /data/tmux/plugins/tmux-resurrect && echo "installed"`,
      uninstall: [`rm -rf /data/tmux/plugins/tmux-resurrect`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       TESTING & QA
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'pytest', name: 'pytest', category: 'testing', color: '#0A9EDC',
      description: 'Python testing framework with fixtures, parametrize, and plugins.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://pytest.org', tags: ['test', 'python', 'unit'],
      priority: 'essential', persistent: true,
      install: [PY('pytest pytest-cov')],
      verify: `PYTHONPATH=${PYLIB_DIR} python3 -c "import pytest; print(pytest.__version__)"`,
      uninstall: [`rm -rf ${PYLIB_DIR}/pytest ${PYLIB_DIR}/_pytest ${PYLIB_DIR}/pytest-* ${PYLIB_DIR}/pytest_cov*`]
    },
    {
      id: 'locust', name: 'Locust', category: 'testing', color: '#1E9600',
      description: 'Scalable load testing in Python. Write user behavior, not XML.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://locust.io', tags: ['load', 'test', 'stress'],
      priority: 'optional', persistent: true,
      install: [PY('locust')],
      verify: `PYTHONPATH=${PYLIB_DIR} ${PYLIB_DIR}/bin/locust --version 2>&1 | head -n1`,
      uninstall: [`rm -rf ${PYLIB_DIR}/locust ${PYLIB_DIR}/locust-* ${PYLIB_DIR}/bin/locust`]
    },
    {
      id: 'wrk', name: 'wrk', category: 'testing', color: '#2C3E50',
      description: 'Modern HTTP benchmarking tool with scripting support.',
      size: '~500 KB', sizeBytes: 512000, license: 'Apache-2.0',
      homepage: 'https://github.com/wg/wrk', tags: ['benchmark', 'http', 'load'],
      priority: 'optional', persistent: false,
      install: [APT('wrk')],
      verify: 'wrk --version 2>&1 | head -n1',
      uninstall: [`apt-get remove -y wrk && apt-get autoremove -y`]
    },

    /* ═══════════════════════════════════════════════════════════════════
       MISC UTILITIES
       ═══════════════════════════════════════════════════════════════════ */

    {
      id: 'tmux', name: 'tmux', category: 'misc', color: '#1BB91F',
      description: 'Terminal multiplexer. Already installed — this is a version check.',
      size: '~1 MB', sizeBytes: 1048576, license: 'ISC',
      homepage: 'https://github.com/tmux/tmux', tags: ['tmux', 'multiplexer', 'session'],
      priority: 'essential', persistent: false,
      install: [APT('tmux')],
      verify: 'tmux -V',
      uninstall: [`apt-get remove -y tmux && apt-get autoremove -y`]
    },
    {
      id: 'neofetch', name: 'neofetch', category: 'misc', color: '#3498DB',
      description: 'CLI system info display with ASCII art and colors.',
      size: '~100 KB', sizeBytes: 102400, license: 'MIT',
      homepage: 'https://github.com/dylanaraps/neofetch', tags: ['info', 'system', 'ascii'],
      priority: 'optional', persistent: false,
      install: [APT('neofetch')],
      verify: 'neofetch --version 2>&1 | head -n1',
      uninstall: [`apt-get remove -y neofetch && apt-get autoremove -y`]
    },
    {
      id: 'asciinema', name: 'asciinema', category: 'misc', color: '#E6E6E6',
      description: 'Record and share terminal sessions as lightweight asciicast.',
      size: '~3 MB', sizeBytes: 3145728, license: 'GPL-3.0',
      homepage: 'https://asciinema.org', tags: ['record', 'terminal', 'share'],
      priority: 'optional', persistent: false,
      install: [APT('asciinema')],
      verify: 'asciinema --version',
      uninstall: [`apt-get remove -y asciinema && apt-get autoremove -y`]
    },
    {
      id: 'croc', name: 'croc', category: 'misc', color: '#4A90D9',
      description: 'Easily and securely send files between computers with a code phrase.',
      size: '~5 MB', sizeBytes: 5242880, license: 'MIT',
      homepage: 'https://github.com/schollz/croc', tags: ['transfer', 'p2p', 'file'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/schollz/croc/releases/download/v10.0.12/croc_v10.0.12_Linux-64bit.tar.gz | tar -xz && mv croc ${BIN_DIR}/croc && chmod +x ${BIN_DIR}/croc`
      ],
      verify: `${BIN_DIR}/croc --version`,
      uninstall: [`rm -f ${BIN_DIR}/croc`]
    },
    {
      id: 'fclones', name: 'fclones', category: 'misc', color: '#8B5A2B',
      description: 'Fast duplicate file finder with deduplication support.',
      size: '~3 MB', sizeBytes: 3145728, license: 'MIT',
      homepage: 'https://github.com/pkolaczk/fclones', tags: ['duplicate', 'dedupe', 'find'],
      priority: 'optional', persistent: true,
      install: [
        `cd /tmp && curl -fsSL https://github.com/pkolaczk/fclones/releases/download/v0.34.0/fclones-0.34.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv fclones ${BIN_DIR}/fclones && chmod +x ${BIN_DIR}/fclones`
      ],
      verify: `${BIN_DIR}/fclones --version | head -n1`,
      uninstall: [`rm -f ${BIN_DIR}/fclones`]
    }

  ];
}

module.exports = createCatalog;
