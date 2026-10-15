"""Download reference card images and organize them for model training.

Images are fetched from the same public One Piece catalog used by the app.
Place real camera photos of a card in that card's folder before training for
useful real-world validation.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "data" / "cards"
ENDPOINTS = ("allSetCards", "allSTCards", "allPromoCards", "allDonCards")


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "optcg-scanner-training/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def records_from(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("value", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return list(payload.values())
    return []


def safe_label(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip()).strip("_")


def main():
    cards = {}
    for endpoint in ENDPOINTS:
        url = f"https://www.optcgapi.com/api/{endpoint}/"
        try:
            for item in records_from(fetch_json(url)):
                if not isinstance(item, dict):
                    continue
                code = item.get("card_image_id") or item.get("card_id") or item.get("card_set_id")
                image = item.get("card_image") or item.get("card_image_url") or item.get("image_url")
                if isinstance(code, str) and isinstance(image, str) and image.startswith("https://"):
                    cards[code] = {"code": code, "name": str(item.get("card_name") or item.get("name") or code), "image": image}
        except (OSError, ValueError, urllib.error.URLError) as error:
            print(f"Catalog endpoint unavailable ({endpoint}): {error}")

    if not cards:
        raise SystemExit("No cards found. Check the catalog connection and try again.")

    DATASET.mkdir(parents=True, exist_ok=True)

    def download(card):
        label = safe_label(card["code"])
        folder = DATASET / label
        folder.mkdir(parents=True, exist_ok=True)
        manifest = {"code": card["code"], "name": card["name"]}
        (folder / "card.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        image_path = folder / "reference.jpg"
        if image_path.exists() and image_path.stat().st_size > 0:
            return "cached"
        try:
            request = urllib.request.Request(card["image"], headers={"User-Agent": "optcg-scanner-training/1.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                image_path.write_bytes(response.read())
            return "downloaded"
        except (OSError, urllib.error.URLError) as error:
            print(f"Image unavailable ({card['code']}): {error}")
            return "failed"

    counts = {"downloaded": 0, "cached": 0, "failed": 0}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(download, card) for card in cards.values()]
        for index, future in enumerate(as_completed(futures), start=1):
            counts[future.result()] += 1
            if index % 100 == 0:
                print(f"Processed {index}/{len(futures)} images")
            time.sleep(0.01)
    print(f"Catalog: {len(cards)} printings; downloaded {counts['downloaded']}, cached {counts['cached']}, failed {counts['failed']}.")
    print(f"Dataset: {DATASET}")
    print("Add varied real card photos to each matching card folder, then run train_model.py.")


if __name__ == "__main__":
    main()
