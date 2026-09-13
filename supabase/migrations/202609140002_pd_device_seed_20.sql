-- 來源：Woody 提供的「東莞恆群手機/手錶登記表」截圖。
-- 原始文字完整保留；型號、序號等未由原表證明的欄位不猜測。
-- 保管人先保留原名，待 Admin 在前台連結 Platform 使用者。

do $$
declare actor text;
begin
  select emp_id into actor from public.users where role='admin' and active=true order by emp_id limit 1;
  if actor is null then raise exception 'No active Platform Admin available for device seed'; end if;

  insert into public.pd_device_assets
    (asset_code,type_code,original_name,brand,model,color,specifications,aliases,status,approval_status,
     custodian_original_name,ownership_unit,current_location,source_note,created_by,updated_by,missing_fields)
  values
    ('P01','P','Iphone 8 金色','Apple','iPhone 8','金色','{}','{"蘋果手機","苹果手机","Apple phone"}','available','pending','陳鎮銘','東莞恆群','CN','原清單序號 1',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P02','P','Iphone SE2 红色 128G','Apple','iPhone SE（第 2 代）','紅色','{"容量":"128GB"}','{"iPhone SE2","苹果手机"}','available','pending','李遠儀','東莞恆群','CN','原清單序號 2',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P03','P','Iphone X 128G','Apple','iPhone X',null,'{"容量":"128GB"}','{"蘋果手機","苹果手机"}','available','pending','阮林森','東莞恆群','CN','原清單序號 3',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P04','P','Iphone11 pro 暗夜绿色 64G','Apple','iPhone 11 Pro','夜幕綠色','{"容量":"64GB"}','{"iPhone11 pro","蘋果手機"}','available','pending','徐福威','東莞恆群','CN','原清單序號 4',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P05','P','Iphone12 pro128G 石墨黑','Apple','iPhone 12 Pro','石墨色','{"容量":"128GB"}','{"iPhone12 pro","蘋果手機"}','available','pending','徐福威','東莞恆群','CN','原清單序號 5',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P06','P','Iphone13 pro128G 远峰蓝','Apple','iPhone 13 Pro','天峰藍色','{"容量":"128GB"}','{"iPhone13 pro","蘋果手機"}','available','pending','徐福威','東莞恆群','CN','原清單序號 6',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P07','P','三星S7','Samsung','Galaxy S7',null,'{}','{"三星S7","Samsung S7"}','available','pending','徐福威','東莞恆群','CN','原清單序號 7',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('X01','X','Magsafe 充电器','Apple','MagSafe 充電器',null,'{}','{"MagSafe charger","磁吸充電器","磁吸充电器"}','available','pending','徐福威','東莞恆群','CN','原清單序號 8',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('X02','X','AirTag','Apple','AirTag',null,'{}','{"Apple tracker","蘋果定位器","苹果定位器"}','available','pending','徐福威','東莞恆群','CN','原清單序號 9',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('P08','P','Iphone14 Pro 256GB','Apple','iPhone 14 Pro',null,'{"容量":"256GB"}','{"iPhone14 Pro","蘋果手機"}','available','pending','劉振昕','東莞恆群','CN','原清單序號 10',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('T01','T','IPAD（iPad A2316 2020年发布的 iPad Air（第 4 代））','Apple','iPad Air（第 4 代）',null,'{}','{"iPad A2316","iPad Air 4","蘋果平板"}','available','pending','李文千','東莞恆群','CN','原清單序號 11；A2316 由原表提供，尚待 Admin 核對',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('P09','P','三星S6','Samsung','Galaxy S6',null,'{}','{"三星S6","Samsung S6"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 12',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P10','P','Iphone12 por max128G金色','Apple','iPhone 12 Pro Max','金色','{"容量":"128GB"}','{"iPhone12 Pro Max","蘋果手機"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 13',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('P11','P','Iphone11 紫色 128G','Apple','iPhone 11','紫色','{"容量":"128GB"}','{"蘋果手機","苹果手机"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 14',actor,actor,'{manufacturer_serial,imei1,purchase_information}'),
    ('E01','E','AirPods Pro 3','Apple','AirPods Pro 3',null,'{}','{"AirPods","Apple earphones","蘋果耳機"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 15；原始名稱可能不是正式型號，未確認前不改寫',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('W01','W','iWatch Series 4手表','Apple','Apple Watch Series 4',null,'{}','{"iWatch Series 4","蘋果手錶","苹果手表"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 16',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('W02','W','iWatch Series 5手表','Apple','Apple Watch Series 5',null,'{}','{"iWatch Series 5","蘋果手錶","苹果手表"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 17',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('W03','W','iWatch Series 11手表','Apple','Apple Watch Series 11',null,'{}','{"iWatch Series 11","蘋果手錶","苹果手表"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 18；正式型號待 Admin 核對',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('X03','X','苹果手表的充电器','Apple','Apple Watch 充電器',null,'{}','{"Apple Watch charger","蘋果手錶充電器","苹果手表充电器"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 19',actor,actor,'{manufacturer_serial,purchase_information}'),
    ('X04','X','苹果20W-PD充电器','Apple','20W USB-C 電源轉接器',null,'{"功率":"20W"}','{"Apple 20W charger","PD充電器","PD充电器"}','available','pending','蔣金明','東莞恆群','CN','原清單序號 20',actor,actor,'{manufacturer_serial,purchase_information}')
  on conflict(asset_code) do nothing;

  update public.pd_device_assets a
     set custodian_emp_id = u.emp_id,
         updated_by = actor
    from public.users u
   where a.source_note like '原清單序號 %'
     and a.custodian_emp_id is null
     and u.active = true
     and (u.name_zh = a.custodian_original_name or u.name_en = a.custodian_original_name)
     and 1 = (select count(*) from public.users u2
              where u2.active=true and (u2.name_zh=a.custodian_original_name or u2.name_en=a.custodian_original_name));
end $$;
