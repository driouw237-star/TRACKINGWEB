create or replace function app.get_public_tracking(p_tracking_code text)
returns table (
  tracking_code text, status app.shipment_status, origin_city text, dest_city text,
  current_location text, estimated_delivery text, package_type text, weight text,
  dimensions text, contents text, service_level text, handling app.package_handling,
  insured boolean, amount_paid numeric, sender_name text, sender_company text,
  sender_email text, sender_phone text, sender_address text, receiver_name text,
  receiver_company text, receiver_email text, receiver_phone text, receiver_address text,
  coords jsonb, activities jsonb, created_at timestamptz, updated_at timestamptz
)
language plpgsql 
security definer 
set search_path = app, public
as $$
begin
  return query
  select s.tracking_code, s.status, s.origin_city, s.dest_city, s.current_location,
         s.estimated_delivery, s.package_type, s.weight, s.dimensions, s.contents,
         s.service_level, s.handling, s.insured, s.amount_paid, s.sender_name,
         s.sender_company, s.sender_email, s.sender_phone, s.sender_address,
         s.receiver_name, s.receiver_company, s.receiver_email, s.receiver_phone,
         s.receiver_address, s.coords, s.activities, s.created_at, s.updated_at
    from app.shipments s
   where s.tracking_code = p_tracking_code;
end;
$$;

-- Allow anonymous users to use this function
grant execute on function app.get_public_tracking(text) to anon, authenticated;