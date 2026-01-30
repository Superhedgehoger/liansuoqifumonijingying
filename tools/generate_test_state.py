import argparse
import random
from pathlib import Path

import sys

# Make `src/` importable when running as a script.
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from simgame.models import GameState, InventoryItem, Station, Store
from simgame.presets import apply_default_store_template
from simgame.storage import save_state


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def _pick(rng: random.Random, items):
    return items[rng.randrange(0, len(items))]


def _sample_station_type(rng: random.Random, region: str) -> str:
    # A small variety, biased by region/urbanization.
    base = ["城市站", "高速站", "乡镇站", "国道站", "景区站"]
    if region in {"华东", "华南", "华北"}:
        weights = [0.42, 0.16, 0.18, 0.14, 0.10]
    else:
        weights = [0.28, 0.14, 0.30, 0.18, 0.10]
    r = rng.random()
    acc = 0.0
    for t, w in zip(base, weights):
        acc += float(w)
        if r <= acc:
            return t
    return base[-1]


def _traffic_profile(rng: random.Random, station_type: str, city: str) -> tuple[int, int, float]:
    # fuel vehicles drive most orders; visitor is small but non-zero.
    city_tier_boost = 1.0
    if city in {"北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "重庆"}:
        city_tier_boost = 1.25
    if city in {"乌鲁木齐", "兰州", "银川", "西宁"}:
        city_tier_boost = 0.92

    if station_type == "高速站":
        base_fuel = rng.randint(900, 1800)
        base_vis = rng.randint(20, 80)
        vol = _clamp(rng.uniform(0.08, 0.18), 0.0, 1.0)
    elif station_type == "城市站":
        base_fuel = rng.randint(650, 1300)
        base_vis = rng.randint(10, 45)
        vol = _clamp(rng.uniform(0.06, 0.14), 0.0, 1.0)
    elif station_type == "景区站":
        base_fuel = rng.randint(420, 980)
        base_vis = rng.randint(25, 120)
        vol = _clamp(rng.uniform(0.12, 0.28), 0.0, 1.0)
    elif station_type == "国道站":
        base_fuel = rng.randint(520, 1200)
        base_vis = rng.randint(8, 35)
        vol = _clamp(rng.uniform(0.08, 0.20), 0.0, 1.0)
    else:  # 乡镇站
        base_fuel = rng.randint(280, 720)
        base_vis = rng.randint(5, 18)
        vol = _clamp(rng.uniform(0.06, 0.16), 0.0, 1.0)

    fuel = int(round(base_fuel * city_tier_boost))
    vis = int(round(base_vis * (0.9 + rng.random() * 0.4)))
    return max(0, fuel), max(0, vis), vol


def build_state(stations_count: int, seed: int) -> GameState:
    rng = random.Random(int(seed))

    # Regions -> cities -> districts. Keep simple and test-friendly.
    regions: dict[str, dict[str, list[str]]] = {
        "华北": {
            "北京": ["朝阳", "海淀", "通州", "昌平"],
            "天津": ["河西", "南开", "滨海"],
            "石家庄": ["长安", "裕华", "桥西"],
        },
        "华东": {
            "上海": ["浦东", "闵行", "嘉定"],
            "杭州": ["滨江", "余杭", "西湖"],
            "南京": ["建邺", "江宁", "鼓楼"],
            "苏州": ["工业园", "吴中", "昆山"],
        },
        "华南": {
            "广州": ["天河", "番禺", "黄埔"],
            "深圳": ["南山", "宝安", "龙岗"],
            "厦门": ["思明", "湖里"],
            "南宁": ["青秀", "西乡塘"],
        },
        "华中": {
            "武汉": ["武昌", "江汉", "洪山"],
            "长沙": ["岳麓", "雨花", "开福"],
            "郑州": ["金水", "二七", "郑东新区"],
        },
        "西南": {
            "成都": ["武侯", "高新", "双流"],
            "重庆": ["渝北", "江北", "南岸"],
            "昆明": ["五华", "官渡"],
            "贵阳": ["观山湖", "云岩"],
        },
        "西北": {
            "西安": ["雁塔", "未央", "长安"],
            "兰州": ["城关", "七里河"],
            "乌鲁木齐": ["天山", "沙依巴克"],
            "银川": ["兴庆", "金凤"],
        },
        "东北": {
            "沈阳": ["和平", "浑南"],
            "大连": ["甘井子", "金州"],
            "长春": ["南关", "朝阳"],
            "哈尔滨": ["南岗", "道里"],
        },
    }

    providers = [
        "自营",
        "加盟A",
        "加盟B",
        "外包运营",
        "合作方C",
    ]

    state = GameState()

    # Spread stations on a pseudo map (0-100) with slight jitter.
    cols = 16
    rows = max(1, (stations_count + cols - 1) // cols)

    region_names = list(regions.keys())

    for i in range(stations_count):
        region = _pick(rng, region_names)
        city_map = regions[region]
        city = _pick(rng, list(city_map.keys()))
        district = _pick(rng, city_map[city])
        provider = _pick(rng, providers)
        station_type = _sample_station_type(rng, region)

        fuel, visitor, vol = _traffic_profile(rng, station_type, city)

        sid = f"S{i+1:03d}"
        st_name = f"{city}{district}-{station_type}-{i+1:03d}"

        # map coords (percent)
        c = i % cols
        r = i // cols
        x = (c + 0.5) * (100.0 / cols) + rng.uniform(-1.6, 1.6)
        y = (r + 0.5) * (100.0 / rows) + rng.uniform(-1.6, 1.6)

        station = Station(
            station_id=sid,
            name=st_name,
            station_type=station_type,
            city=city,
            district=district,
            provider=provider,
            map_x=_clamp(x, 1.0, 99.0),
            map_y=_clamp(y, 1.0, 99.0),
            fuel_vehicles_per_day=fuel,
            visitor_vehicles_per_day=visitor,
            traffic_volatility=_clamp(vol, 0.0, 1.0),
        )
        state.stations[sid] = station

        # Also create one store per station so you can run a full simulation.
        mid = f"M{i+1:03d}"
        store = Store(store_id=mid, name=f"{city}{district}汽服门店-{i+1:03d}", station_id=sid)
        store.city = city
        store.district = district
        store.provider = provider
        store.status = "open"

        # Small variations for testing.
        store.fixed_overhead_per_day = float(rng.choice([160.0, 200.0, 240.0, 300.0, 380.0]))
        store.traffic_conversion_rate = _clamp(rng.normalvariate(1.0, 0.12), 0.6, 1.5)
        store.labor_hour_price = float(rng.choice([90.0, 120.0, 150.0, 180.0]))
        store.strict_parts = bool(rng.random() < 0.7)

        apply_default_store_template(store)

        # Minimal baseline inventory to avoid immediate strict_parts deadlock.
        store.inventory.setdefault("CHEM", InventoryItem(sku="CHEM", name="洗车液(升)", unit_cost=20.0, qty=200.0))
        store.inventory.setdefault("OIL", InventoryItem(sku="OIL", name="机油(升)", unit_cost=35.0, qty=120.0))
        store.inventory.setdefault("FILTER", InventoryItem(sku="FILTER", name="机滤(个)", unit_cost=25.0, qty=60.0))
        store.inventory.setdefault("PATCH", InventoryItem(sku="PATCH", name="补胎胶片(个)", unit_cost=3.0, qty=240.0))
        store.inventory.setdefault(
            "WIPER_BLADE", InventoryItem(sku="WIPER_BLADE", name="雨刮条(根)", unit_cost=18.0, qty=90.0)
        )

        state.stores[mid] = store

    return state


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate test state with many stations/stores")
    ap.add_argument("--stations", type=int, default=160)
    ap.add_argument("--seed", type=int, default=20260129)
    ap.add_argument(
        "--out",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "data" / "state_test_160.json"),
    )
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    state = build_state(stations_count=max(1, int(args.stations)), seed=int(args.seed))
    save_state(state, path=out)
    print(f"wrote: {out}")
    print(f"stations: {len(state.stations)}  stores: {len(state.stores)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
