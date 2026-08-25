import argparse
from pathlib import Path

from scraper import load_existing, save_csv


def merge_csv(base_path: str, incoming_path: str) -> int:
    """Merge incoming measurements into base_path and return the row count."""
    base_rows = load_existing(base_path)
    incoming_rows = load_existing(incoming_path)

    if not incoming_rows:
        raise ValueError(f"Ulazni CSV nema valjanih mjerenja: {incoming_path}")

    base_rows.update(incoming_rows)
    save_csv(base_path, base_rows)
    return len(base_rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Spoji mjerenja iz ulaznog CSV-a u glavni CSV."
    )
    parser.add_argument("base", help="Glavni CSV u koji se podaci spajaju")
    parser.add_argument("incoming", help="CSV čiji se podaci dodaju")
    args = parser.parse_args()

    if Path(args.base).resolve() == Path(args.incoming).resolve():
        parser.error("Glavni i ulazni CSV moraju biti različite datoteke")

    row_count = merge_csv(args.base, args.incoming)
    print(f"CSV datoteke spojene. Ukupno redaka: {row_count}")


if __name__ == "__main__":
    main()
