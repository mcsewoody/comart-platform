create or replace function public.pd_device_refresh_search_text() returns trigger
language plpgsql set search_path=public as $$
declare
  type_aliases text;
begin
  type_aliases := case new.type_code
    when 'P' then '手機 手机 phone smartphone mobile phone'
    when 'W' then '手錶 手表 watch smartwatch'
    when 'E' then '耳機 耳机 earphone earphones earbuds headphone headphones'
    when 'G' then '眼鏡 眼镜 glasses smart glasses'
    when 'S' then '喇叭 音箱 speaker speakers'
    when 'T' then '平板 平板电脑 tablet ipad'
    when 'N' then '筆電 笔记本 筆記型電腦 laptop notebook'
    when 'D' then '桌機 台式机 桌上型電腦 desktop'
    when 'X' then '配件 附件 accessory accessories'
    else ''
  end;
  new.search_text := lower(concat_ws(' ', new.asset_code, new.original_name, new.brand, new.model,
    new.official_model_code, new.manufacturer_serial, new.imei1, new.imei2, new.color,
    new.custodian_original_name, new.ownership_unit, new.current_location, type_aliases,
    array_to_string(new.aliases,' '), coalesce(new.specifications::text,'')));
  return new;
end $$;

update public.pd_device_assets set updated_at = updated_at;
