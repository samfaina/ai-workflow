# PROTOTYPE helper: swap the skills data block in template.html for skills.js.
import pathlib
here = pathlib.Path(__file__).parent
t = here / 'template.html'
h = t.read_text(encoding='utf8')
a = h.index('const SKILLS = [')
b = h.index("document.getElementById('skilllist').addEventListener")
h = h[:a] + (here / 'skills.js').read_text(encoding='utf8') + h[b:]
h = h.replace('<p class="lead">Grouped by the part it plays. Pick one to see what it needs and what it leaves done.</p>',
              '<p class="lead">All 38, grouped by the part each plays. Pick one to see what it needs, who calls it and what it leaves done.</p>')
t.write_text(h, encoding='utf8')
