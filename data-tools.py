import sys
from collections import defaultdict
from dataclasses import dataclass
import json


@dataclass
class MapItem:
    trait: str
    weight: int


def normalize(data):
    chname = '-'
    for line in data:
        if not line.strip():
            continue
        if not line.startswith('\t'):
            chname = line[:line.index('\t')]
            yield line
        else:
            yield chname + line


def parse(data):
    items = defaultdict(list)
    for line in data:
        trait, val, weight = line.split('\t')
        items[val].append(
            MapItem(trait, int(weight))
        )
    return format_result(items)


def parse_t2t(data):
    items = defaultdict(list)
    for line in data:
        trait, val, weight = line.split('\t')
        items[trait].append(
            MapItem(val, int(weight))
        )
    return format_result(items)


def format_result(items):
    res = {
        "name": "-",
        "values": [
            {
                "value": k,
                "map": [v.__dict__ for v in values]
            }
            for k, values in items.items()
        ]
    }
    res['values'].sort(key=lambda x: x['value'])
    return json.dumps(res, indent=4, ensure_ascii=False)


def main():
    match sys.argv:
        case _, '--normalize' | '-n':
            print(*normalize(sys.stdin), sep='')
        case _, '--parse' | '-p':
            print(parse(sys.stdin))
        case _, '--t2t' | '-t':
            print(parse_t2t(sys.stdin))
        case _:
            raise Exception('only normalize (-n | --normalize) or parse (-p | --parse) are available')


if __name__ == '__main__':
    main()
