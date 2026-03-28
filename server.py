import http.server
import webbrowser
import os

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

webbrowser.open(f"http://localhost:{PORT}")
print(f"Serving at http://localhost:{PORT}  (Ctrl+C to stop)")
http.server.HTTPServer(("", PORT), http.server.SimpleHTTPRequestHandler).serve_forever()
