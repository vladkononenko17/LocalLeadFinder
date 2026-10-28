// Единый каталог ниш: одна категория → теги OSM и запросы для Google Places.
// Раньше категория искалась только в amenity/shop/craft/tourism/office, поэтому
// leisure=fitness_centre и healthcare=* не находились вообще.

export type CategoryDef = {
  label: string;
  osm: Array<[key: string, value: string]>;
  google: { queries: string[]; includedType?: string };
};

export const CATEGORIES: Record<string, CategoryDef> = {
  cafe: { label: "Кафе", osm: [["amenity", "cafe"]], google: { queries: ["кав'ярня"], includedType: "cafe" } },
  restaurant: { label: "Ресторан", osm: [["amenity", "restaurant"]], google: { queries: ["ресторан"], includedType: "restaurant" } },
  beauty: { label: "Салон красоты", osm: [["shop", "beauty"]], google: { queries: ["салон краси"], includedType: "beauty_salon" } },
  hairdresser: { label: "Парикмахерская", osm: [["shop", "hairdresser"]], google: { queries: ["перукарня", "барбершоп"], includedType: "hair_care" } },
  cosmetics: { label: "Косметика", osm: [["shop", "cosmetics"]], google: { queries: ["магазин косметики"] } },
  dentist: { label: "Стоматология", osm: [["amenity", "dentist"], ["healthcare", "dentist"]], google: { queries: ["стоматологія"], includedType: "dentist" } },
  clinic: { label: "Клиника", osm: [["amenity", "clinic"], ["healthcare", "clinic"]], google: { queries: ["приватна клініка", "медичний центр"] } },
  doctors: { label: "Врач", osm: [["amenity", "doctors"], ["healthcare", "doctor"]], google: { queries: ["лікар приватна практика"], includedType: "doctor" } },
  car_repair: { label: "СТО", osm: [["shop", "car_repair"], ["craft", "car_repair"]], google: { queries: ["СТО", "автосервіс"], includedType: "car_repair" } },
  car_wash: { label: "Автомойка", osm: [["amenity", "car_wash"]], google: { queries: ["автомийка"], includedType: "car_wash" } },
  tyres: { label: "Шиномонтаж", osm: [["shop", "tyres"]], google: { queries: ["шиномонтаж"] } },
  fitness_centre: { label: "Фитнес", osm: [["leisure", "fitness_centre"]], google: { queries: ["фітнес клуб", "спортзал"], includedType: "gym" } },
};

const FALLBACK_KEYS = ["amenity", "shop", "craft", "tourism", "office", "leisure", "healthcare"];

/** Разбирает строку вида "cafe|car_repair". Неизвестный slug ищется по всем ключам OSM и как текст в Google. */
export function resolveCategories(input: string): Array<{ slug: string } & CategoryDef> {
  const slugs = [...new Set(input.split("|").map((v) => v.trim().toLowerCase()).filter((v) => /^[a-z_]+$/.test(v)))];
  return slugs.map((slug) =>
    CATEGORIES[slug]
      ? { slug, ...CATEGORIES[slug] }
      : { slug, label: slug, osm: FALLBACK_KEYS.map((k) => [k, slug] as [string, string]), google: { queries: [slug.replaceAll("_", " ")] } },
  );
}
