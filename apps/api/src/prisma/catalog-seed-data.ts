import type { CatalogBaitType } from '../catalog/catalog.constants.js';

export interface CatalogSeedLocationData {
  number: number;
  name: string;
}

export interface CatalogSeedFishingBaseData {
  name: string;
  locations: readonly CatalogSeedLocationData[];
  fish: readonly string[];
}

export interface CatalogSeedBaitData {
  name: string;
  type: CatalogBaitType;
}

export interface CatalogSeedData {
  fish: readonly string[];
  bases: readonly CatalogSeedFishingBaseData[];
  baits: readonly CatalogSeedBaitData[];
  screenAnchors: readonly string[];
}

export const AMUR_FISH = [
  'Акула',
  'Акула песчанная',
  'Акула свинья',
  'Амурская Щука',
  'Амурский Осетр',
  'Амурский Сиг',
  'Ауха',
  'Белокровка Аэлиты',
  'Белокровка большеглазая',
  'Белокровка Ричардсона',
  'Белый амур',
  'Бородатка Скуры',
  'Верхогляд',
  'Владиславия',
  'Вьюн',
  'Гвоздарь Световидова',
  'Глубинная щука',
  'Голец Дальнеозерный',
  'Горбуша',
  'Дорудон ужасный',
  'Ехидна белолобая',
  'Желтощек',
  'Зигориза',
  'Змееголов',
  'Калуга',
  'Карась серебряный',
  'Кета',
  'Кижуч',
  'Кит древний',
  'Китовая акула',
  'Котилокара',
  'Ленок',
  'Лещ',
  'Мелвиллов Левиафан',
  'Миофисетер',
  'Монгольский краснопер',
  'Морская свинья очковая',
  'Морская свянья обыкновенная',
  'Налим',
  'Окукайя',
  'Паук морской антарктический',
  'Перуцетус',
  'Пескарь',
  'Пестрый конь',
  'Понтогеней',
  'Ротан',
  'Рыба луна короткая',
  'Сазан',
  'Сима',
  'Синтиацетус',
  'Скат',
  'Скрипун',
  'Сом Амурский',
  'Сом Солдатова',
  'Таймень',
  'Титаноцетус',
  'Толстолобик',
  'Троегуб',
  'Уссурийская востробрюшка',
  'Уссурийская касатка',
  'Хариус',
  'Черный амур',
  'Черный Лещ',
  'Язь',
] as const;

export const REAL_CATALOG_DATA = {
  fish: AMUR_FISH,
  bases: [
    {
      name: 'Амур',
      locations: [
        { number: 1, name: 'Протока бешеная - створы' },
        { number: 2, name: 'Протока бешеная - хутор' },
        { number: 3, name: 'Протока бешеная - огороды' },
        { number: 4, name: 'Старый затон' },
        { number: 5, name: 'Богачёво' },
        { number: 6, name: 'Лисья гора' },
        { number: 7, name: 'Понтонный мост' },
        { number: 8, name: 'Амурская протока' },
        { number: 9, name: 'Ширшиха' },
      ],
      fish: AMUR_FISH,
    },
  ],
  baits: [],
  screenAnchors: ['Удочка', 'Леска', 'Блокнот', 'Рюкзак', 'Катушка', 'Чат', 'Снасти', 'События'],
} as const satisfies CatalogSeedData;
