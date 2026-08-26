#!/usr/bin/env python3
"""Check whether EPA has republished the IIOAC distribution.

    python3 tools/check_epa.py            # report only
    python3 tools/check_epa.py --write    # record a change in data/epa-version.json

Compares the ETag, Last-Modified and Content-Length of EPA's zip against the
baseline in data/epa-version.json. A HEAD request, so it costs nothing and does
not download the 331 MB archive.

Exit codes: 0 unchanged, 2 changed, 1 the check itself failed. A changed
distribution is not an error, it is the signal the site is now potentially stale,
which is why it gets its own code rather than a non-zero failure.
"""
import datetime
import json
import os
import sys
import urllib.request

# How stale the recorded check date may get before it is worth a commit. Weekly
# commits would be 52 no-ops a year in the log and 52 redeploys; never writing at
# all would leave the page claiming a check date that ages silently. Monthly is
# the compromise: the date on the page is never more than about five weeks old.
REFRESH_AFTER_DAYS = 28

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, '..', 'data', 'epa-version.json')


def head(url):
    req = urllib.request.Request(url, method='HEAD')
    with urllib.request.urlopen(req, timeout=60) as r:
        h = r.headers
        return {
            'url': url,
            'etag': h.get('ETag'),
            'lastModified': h.get('Last-Modified'),
            'contentLength': int(h.get('Content-Length') or 0),
        }


def main():
    write = '--write' in sys.argv
    state = json.load(open(STATE))
    base = state['distribution']

    try:
        now = head(base['url'])
    except Exception as e:                       # network, DNS, 5xx, or a moved URL
        print(f'CHECK FAILED  {e}')
        print('If EPA moved or withdrew the download, that is itself worth an issue.')
        return 1

    fields = [k for k in ('etag', 'lastModified', 'contentLength')
              if base.get(k) != now.get(k)]
    today = datetime.date.today().isoformat()

    if not fields:
        print(f'unchanged  etag={now["etag"]}  {now["contentLength"]} bytes')
        if write:
            was = datetime.date.fromisoformat(state['lastChecked'])
            age = (datetime.date.today() - was).days
            if age >= REFRESH_AFTER_DAYS:
                state['lastChecked'] = today
                json.dump(state, open(STATE, 'w'), indent=2)
                open(STATE, 'a').write('\n')
                print(f'refreshed the check date ({age} days old)')
            else:
                print(f'check date is {age} days old, left alone')
        return 0

    print('EPA DISTRIBUTION CHANGED')
    for k in fields:
        print(f'  {k}: {base.get(k)!r} -> {now.get(k)!r}')
    print('\nThis port implements EPA IIOAC ' + state['portedEpaVersion'] +
          ' and has not been checked against the new file. See ROADMAP.md.')

    if write:
        # The baseline is deliberately NOT advanced. It moves when a human has
        # re-ported and re-validated, so the site keeps disclosing staleness
        # until that happens rather than quietly forgetting.
        state['upstreamChanged'] = True
        state['upstreamChangedOn'] = state.get('upstreamChangedOn') or today
        state['lastChecked'] = today
        json.dump(state, open(STATE, 'w'), indent=2)
        open(STATE, 'a').write('\n')
        print(f'\nrecorded in {os.path.relpath(STATE)}')
    return 2


if __name__ == '__main__':
    sys.exit(main())
