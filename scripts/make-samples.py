#!/usr/bin/env python3
"""Generates the synthetic vitals CSVs and the sample PDF in public/samples. Pure stdlib; all data is fake."""
import math, random, datetime as dt, pathlib, zlib

out = pathlib.Path(__file__).resolve().parent.parent / "public" / "samples"
random.seed(42)

# --- 30-day home blood-pressure / pulse / glucose log (trend: slowly improving, morning/evening readings)
rows = ["timestamp,systolic,diastolic,pulse,glucose_mgdl,weight_kg"]
start = dt.datetime(2026, 8, 1, 7, 30)
for day in range(45):
    for slot, (h, m) in enumerate([(7, 30), (20, 15)]):
        t = start + dt.timedelta(days=day, hours=h - 7, minutes=m - 30)
        base_sys = 152 - day * 0.45 + (4 if slot else 0)
        sys_ = round(base_sys + random.gauss(0, 5))
        dia = round(sys_ * 0.6 + random.gauss(0, 3))
        pulse = round(76 + random.gauss(0, 5) - day * 0.05)
        glu = round((128 if slot == 0 else 152) - day * 0.6 + random.gauss(0, 12))
        wt = round(84.2 - day * 0.06 + random.gauss(0, 0.25), 1)
        rows.append(f"{t:%Y-%m-%d %H:%M},{sys_},{dia},{pulse},{glu},{wt}")
(out / "bp-glucose-log.csv").write_text("\n".join(rows) + "\n")

# --- wearable daily export
rows = ["date,resting_hr,hrv_ms,sleep_hours,steps,spo2_pct"]
d0 = dt.date(2026, 7, 20)
for i in range(60):
    d = d0 + dt.timedelta(days=i)
    rows.append(
        f"{d:%Y-%m-%d},{round(68 - i*0.07 + random.gauss(0,2))},{round(34 + i*0.15 + random.gauss(0,4))},"
        f"{round(6.4 + random.gauss(0,0.7),1)},{max(1200,int(5200 + i*45 + random.gauss(0,1800)))},{min(100,round(96.5 + random.gauss(0,0.9)))}"
    )
(out / "wearable-daily.csv").write_text("\n".join(rows) + "\n")

# --- 10 s single-lead ECG @ 250 Hz, sinus rhythm ~72 bpm with HRV + baseline wander + noise
fs, secs = 250, 10
n = fs * secs
sig = [0.0] * n
t_beat = 0.4
beats = []
while t_beat < secs - 0.3:
    beats.append(t_beat)
    rr = 0.83 + random.gauss(0, 0.035)
    t_beat += rr

def g(x, mu, sd, a):
    return a * math.exp(-((x - mu) ** 2) / (2 * sd * sd))

for b in beats:
    for i in range(max(0, int((b - 0.4) * fs)), min(n, int((b + 0.5) * fs))):
        x = i / fs - b
        sig[i] += g(x, -0.18, 0.025, 0.12) + g(x, -0.035, 0.010, -0.14) + g(x, 0.0, 0.012, 1.15) + g(x, 0.03, 0.011, -0.25) + g(x, 0.22, 0.045, 0.32)
rows = ["time_s,ecg_mv"]
for i in range(n):
    v = sig[i] + 0.05 * math.sin(2 * math.pi * 0.25 * i / fs) + random.gauss(0, 0.012)
    rows.append(f"{i/fs:.3f},{v:.4f}")
(out / "ecg-10s-250hz.csv").write_text("\n".join(rows) + "\n")

# --- a plain, dependency-free PDF (text layer) so the PDF extractor has something real to chew on
lines = [
    "GREENFIELD FAMILY CLINIC - VISIT SUMMARY",
    "12 Orchard Lane, Portland, OR 97205    Tel: (503) 555-0121",
    "",
    "Patient Name: Daniel J. Whitaker",
    "DOB: 07/22/1985   MRN: 3391827   Phone: (503) 555-0177",
    "Email: dan.whitaker85@examplemail.com",
    "Address: 3320 SE Alder Street, Portland, OR 97214",
    "Visit date: 08/19/2026   Provider: Dr. Meera Iyer, MD",
    "",
    "Reason for visit: Persistent cough for 3 weeks, mild wheeze at night.",
    "Vitals: BP 122/78 mmHg, HR 74 bpm, Temp 98.4 F, SpO2 98%, BMI 26.1",
    "Assessment: Mr. Whitaker likely has cough-variant asthma. Spirometry shows FEV1 82% predicted.",
    "Plan: Albuterol inhaler 2 puffs PRN, fluticasone 110 mcg 2 puffs BID. Recheck in 4 weeks.",
    "Allergies: Penicillin (rash).",
]
def esc(s): return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
content = "BT /F1 11 Tf 14 TL 50 780 Td\n" + "\n".join(f"({esc(l)}) Tj T*" for l in lines) + "\nET"
objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
pdf = "%PDF-1.4\n"
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(pdf.encode("latin-1")))
    pdf += f"{i} 0 obj\n{o}\nendobj\n"
xref = len(pdf.encode("latin-1"))
pdf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
pdf += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
(out / "visit-summary-whitaker.pdf").write_bytes(pdf.encode("latin-1"))
print("ok")
