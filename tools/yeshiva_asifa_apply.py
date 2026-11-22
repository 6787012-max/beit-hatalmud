# -*- coding: utf-8 -*-
"""מחיל את supabase/migration_yeshiva_asifa.sql על המסד (דרך tools/_sb.py: הטוקן נקרא בזמן ריצה, לא מודפס),
ומדפיס את שני הקישורים לאסיפת הישיבה."""
import io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _sb

here = os.path.dirname(os.path.abspath(__file__))
sql = io.open(os.path.join(here, '..', 'supabase', 'migration_yeshiva_asifa.sql'), encoding='utf-8').read()
if '--links-only' not in sys.argv:
    _sb.q(sql)
    print('migration applied')
row = _sb.q("select public_token, results_key from public.yeshiva_asifa_settings where code='yeshiva-2026-11-25'")[0]
base = 'https://6787012-max.github.io/beit-hatalmud/'
print('PARENTS ' + base + 'yeshiva-asifa.html?g=' + row['public_token'])
print('RESULTS ' + base + 'yeshiva-asifa-results.html?k=' + row['results_key'])
