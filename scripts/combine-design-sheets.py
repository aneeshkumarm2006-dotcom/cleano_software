"""Compose the 29 standalone screens into two importable sheets, one per app.

Each source file is an artifact-canvas page: a <helmet> block of page basics and
then the screen itself inside <x-dc>. html.to.design wants ordinary markup, so we
take only what sits between them and drop the canvas scaffolding.
"""
import re
import pathlib

SRC = pathlib.Path("docs/design/mobile")
OUT = SRC

PRO = [
    ("Main", "Sign in"), ("ProToday", "Today"), ("ProJobs", "My jobs"),
    ("ProJobDetail", "Job detail"), ("ProClock", "On the clock"),
    ("ProAvailable", "Available jobs"), ("ProPay", "My pay"),
    ("ProChat", "Office chat"), ("ProTeamChat", "Team chat"),
    ("ProAnnouncements", "Announcements"), ("ProMore", "More"),
    ("ProInventory", "My kit"), ("ProAvailability", "Availability"),
    ("ProCalendar", "Calendar"), ("ProTraining", "Training"),
    ("ProDocument", "Document"), ("ProStrikes", "My standing"),
]

CUST = [
    ("CustSignUp", "Create account"), ("CustHome", "Home"),
    ("CustBook1", "Book, step 1"), ("CustBook2", "Book, step 2"),
    ("CustQuote", "Ask for a quote"), ("CustBookings", "My bookings"),
    ("CustTracking", "On the way"), ("CustMessages", "Messages"),
    ("CustRate", "Rate the clean"), ("CustAccount", "Account"),
    ("CustHelp", "Help"), ("CustGiftCard", "Gift cards"),
]

BODY = re.compile(r"</helmet>(.*?)</x-dc>", re.S)


def screen(stem: str) -> str:
    text = (SRC / f"{stem}.html").read_text(encoding="utf-8")
    found = BODY.search(text)
    if not found:
        raise SystemExit(f"{stem}: no <x-dc> body found")
    return found.group(1).strip()


def sheet(title: str, screens) -> str:
    cells = []
    for stem, label in screens:
        cells.append(
            '<div style="display:flex;flex-direction:column;gap:12px;">'
            f'<div style="font:700 13px/1 Montserrat,sans-serif;'
            'letter-spacing:.08em;text-transform:uppercase;color:#19356D;">'
            f'{label}</div>{screen(stem)}</div>'
        )
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        f"<title>{title}</title>\n"
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=Montserrat:wght@400;500;600;700;800&display=swap">\n'
        "<style>\nbody{margin:0;padding:56px;background:#ffffff;"
        "font-family:'Gontserrat','Montserrat',system-ui,sans-serif;}\n"
        "a{text-decoration:none;}\n</style>\n</head>\n<body>\n"
        f'<h1 style="margin:0 0 40px;font-size:34px;font-weight:800;'
        f'letter-spacing:-.03em;color:#19356D;">{title}</h1>\n'
        '<div style="display:flex;flex-wrap:wrap;gap:56px;align-items:flex-start;">\n'
        + "\n".join(cells)
        + "\n</div>\n</body>\n</html>\n"
    )


for name, title, group in (
    ("bookmops-pro-all", "Bookmops Pro · cleaner app", PRO),
    ("bookmops-customer-all", "Bookmops · customer app", CUST),
):
    path = OUT / f"{name}.html"
    path.write_text(sheet(title, group), encoding="utf-8")
    kb = path.stat().st_size // 1024
    print(f"{path}  {len(group)} screens  {kb} KB")
