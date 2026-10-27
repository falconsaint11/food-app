-- Limited Time and Seasonal tags, a third kind of tag ('availability') next
-- to food and dietary tags. Like dietary tags, the menu reader only adds them
-- when the menu marks the dish ("limited time", "LTO", "seasonal", a "Fall
-- Menu" section). People can also vote them on when logging.

alter table public.tags drop constraint if exists tags_kind_check;
alter table public.tags
  add constraint tags_kind_check check (kind in ('food', 'dietary', 'availability'));

-- Keywords are matched against normalized dish names (see guess_dish_tags()).
insert into public.tags (slug, label, sort_order, keywords, kind) values
  ('limited-time', 'Limited Time', 400, 'limited time|lto', 'availability'),
  ('seasonal', 'Seasonal', 410, 'seasonal', 'availability')
on conflict (slug) do nothing;
