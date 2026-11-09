"""Empirical Q(H) from published pairs only; estimates never enter training data."""
from bisect import bisect_left
from collections import defaultdict
from hashlib import sha256
import json
import math
from statistics import median

MAX_GAP_CM = 20


def number(value):
    return float(value.replace(',', '.'))


def fit_curve(pairs):
    groups = defaultdict(list)
    for h, q in pairs:
        if math.isfinite(h) and math.isfinite(q) and q >= 0:
            groups[h].append(q)
    if sum(map(len, groups.values())) < 20 or len(groups) < 5:
        return None
    knots = [{'h_cm': h, 'q_m3s': median(qs), 'samples': len(qs),
              'min_q_m3s': min(qs), 'max_q_m3s': max(qs)}
             for h, qs in sorted(groups.items())]
    # Weighted isotonic regression (PAVA) prevents decreasing discharge and
    # polynomial oscillation, while retaining the nonlinear empirical shape.
    blocks = []
    for i, knot in enumerate(knots):
        blocks.append([i, i, knot['q_m3s'] * knot['samples'], knot['samples']])
        while len(blocks) > 1 and blocks[-2][2] / blocks[-2][3] > blocks[-1][2] / blocks[-1][3]:
            right = blocks.pop()
            left = blocks.pop()
            blocks.append([left[0], right[1], left[2] + right[2], left[3] + right[3]])
    for start, end, total, weight in blocks:
        for i in range(start, end + 1):
            knots[i]['q_m3s'] = total / weight
    return {'method': 'median-isotonic-linear-v1', 'knots': knots,
            'min_h_cm': knots[0]['h_cm'], 'max_h_cm': knots[-1]['h_cm'],
            'max_gap_cm': MAX_GAP_CM, 'sample_count': sum(map(len, groups.values()))}


def estimate(curve, h):
    if not curve or not math.isfinite(h):
        return None
    knots = curve['knots']
    i = bisect_left([k['h_cm'] for k in knots], h)
    if i < len(knots) and knots[i]['h_cm'] == h:
        return knots[i]['q_m3s']
    if i == 0 or i == len(knots):
        return None  # No extrapolation outside historical support.
    lo, hi = knots[i - 1], knots[i]
    width = hi['h_cm'] - lo['h_cm']
    if width > curve['max_gap_cm']:
        return None
    return lo['q_m3s'] + (hi['q_m3s'] - lo['q_m3s']) * (h - lo['h_cm']) / width


def score(curve, pairs):
    errors = []
    for h, q in pairs:
        prediction = estimate(curve, h)
        if prediction is not None:
            errors.append(prediction - q)
    return {'tested': len(pairs), 'predicted': len(errors),
            'mae_m3s': round(sum(map(abs, errors)) / len(errors), 6) if errors else None,
            'rmse_m3s': round(math.sqrt(sum(e * e for e in errors) / len(errors)), 6) if errors else None,
            'max_error_m3s': round(max(map(abs, errors)), 6) if errors else None}


def build_estimates(rows):
    # The archive stores only published values; synthetic Q is a separate file.
    ordered = sorted(rows.values(), key=lambda r: (r['DATUM'][6:10], r['DATUM'][3:5], r['DATUM'][:2], r['VRIJEME']))
    paired = [r for r in ordered if r['VODOSTAJ'] and r['PROTOK']]
    pairs = [(number(r['VODOSTAJ']), number(r['PROTOK'])) for r in paired]
    curve = fit_curve(pairs)
    estimates, unsupported = [], 0
    if curve:
        split = int(len(pairs) * .8)
        held_levels = set(sorted({h for h, _ in pairs})[1:-1:5])
        curve['validation'] = {
            'chronological_last_20_percent': score(fit_curve(pairs[:split]), pairs[split:]),
            'held_out_levels': score(fit_curve([(h, q) for h, q in pairs if h not in held_levels]),
                                     [(h, q) for h, q in pairs if h in held_levels]),
        }
        curve['training_start'] = paired[0]['DATUM'] + ' ' + paired[0]['VRIJEME']
        curve['training_end'] = paired[-1]['DATUM'] + ' ' + paired[-1]['VRIJEME']
        curve['id'] = sha256(json.dumps(curve, sort_keys=True).encode()).hexdigest()[:16]
    for row in ordered:
        if not row['VODOSTAJ'] or row['PROTOK']:
            continue
        h = number(row['VODOSTAJ'])
        q = estimate(curve, h)
        if q is None:
            unsupported += 1
        else:
            estimates.append({'date': row['DATUM'], 'time': row['VRIJEME'],
                              'water_cm': h, 'flow_m3s': round(q, 2)})
    return {'schema_version': 1, 'station': 'Ilova - Maslenjača', 'model': curve,
            'unsupported_hours': unsupported, 'estimates': estimates}
