-- Rotas do entregador: várias entregas assumidas de uma vez, em ordem de parada.
-- route_id liga as entregas da mesma saída; route_stop é a posição da parada (1, 2, 3…).
alter table public.orders add column route_id uuid, add column route_stop smallint check (route_stop is null or route_stop between 1 and 50);
create index orders_route_idx on public.orders(store_id, courier_id, route_id) where route_id is not null;
