-- Run once in your Supabase project's SQL Editor. Safe to run again.
-- This installs only the runner_* tables/functions; it does not alter other app data.
begin;
create table if not exists public.runner_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_code uuid not null unique default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 16 and nickname !~ '[[:cntrl:]]')
);
create table if not exists public.runner_records (
  user_id uuid not null references public.runner_players(user_id) on delete cascade,
  mode smallint not null check (mode in (1,3)),
  distance bigint not null check (distance between 0 and 9007199254740991),
  achieved_at timestamptz not null default clock_timestamp(),
  primary key (user_id,mode)
);
-- Existing life-mode records remain intact; old records are ordinary-speed records.
alter table public.runner_records add column if not exists speed_mode text not null default 'normal'
  check (speed_mode in ('normal','fast'));
alter table public.runner_records drop constraint runner_records_pkey;
alter table public.runner_records add primary key (user_id,mode,speed_mode);
drop index if exists public.runner_records_ranking;
create index runner_records_ranking on public.runner_records(mode,speed_mode,distance desc,achieved_at,user_id);
-- Replace the old signatures rather than leaving a writable three-life RPC behind.
drop function if exists public.submit_runner_score(smallint,bigint);
drop function if exists public.runner_leaderboard(smallint,integer,integer);
drop function if exists public.runner_personal_best(smallint);
alter table public.runner_players enable row level security;
alter table public.runner_records enable row level security;
revoke all on public.runner_players,public.runner_records from public,anon,authenticated;

create or replace function public.set_runner_name(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text; v_player public.runner_players;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_name := normalize(btrim(p_nickname),NFC);
  if v_name is null or char_length(v_name) not between 1 and 16 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nickname must contain 1 to 16 characters without controls' using errcode='22023';
  end if;
  insert into public.runner_players(user_id,nickname) values (auth.uid(),v_name)
    on conflict (user_id) do update set nickname=excluded.nickname returning * into v_player;
  return jsonb_build_object('nickname',v_player.nickname,'player_code',v_player.player_code);
end $$;

create or replace function public.submit_runner_score(p_mode smallint,p_distance bigint,p_speed_mode text default 'normal')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_best bigint; v_improved boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_mode is null or p_mode<>1 or p_speed_mode is null or p_speed_mode not in ('normal','fast') or p_distance is null or p_distance not between 0 and 9007199254740991 then
    raise exception 'Invalid mode or distance' using errcode='22023';
  end if;
  if not exists(select 1 from public.runner_players where user_id=auth.uid()) then
    raise exception 'Choose a nickname first' using errcode='22023';
  end if;
  insert into public.runner_records(user_id,mode,speed_mode,distance) values(auth.uid(),p_mode,p_speed_mode,p_distance)
    on conflict(user_id,mode,speed_mode) do update set distance=excluded.distance,achieved_at=clock_timestamp()
      where excluded.distance>public.runner_records.distance
    returning distance into v_best;
  v_improved := found;
  if not v_improved then select distance into v_best from public.runner_records where user_id=auth.uid() and mode=p_mode and speed_mode=p_speed_mode; end if;
  return jsonb_build_object('distance',v_best,'improved',v_improved);
end $$;

create or replace function public.runner_leaderboard(p_mode smallint,p_offset integer default 0,p_limit integer default 20,p_speed_mode text default 'normal')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_entries jsonb; v_more boolean;
begin
  if p_mode is null or p_mode<>1 or p_speed_mode is null or p_speed_mode not in ('normal','fast') or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 20 then
    raise exception 'Invalid leaderboard request' using errcode='22023';
  end if;
  with ranked as (
    select rank() over(order by r.distance desc) as rank,p.nickname,p.player_code,r.distance,r.achieved_at
    from public.runner_records r join public.runner_players p using(user_id) where r.mode=p_mode and r.speed_mode=p_speed_mode
  ), page as (
    select * from ranked order by distance desc,achieved_at,player_code offset p_offset limit p_limit+1
  ), numbered as (
    select *,row_number() over(order by distance desc,achieved_at,player_code) as page_row from page
  ) select coalesce(jsonb_agg(jsonb_build_object('rank',rank,'nickname',nickname,'player_code',player_code,
      'distance',distance,'achieved_at',achieved_at) order by page_row) filter(where page_row<=p_limit),'[]'::jsonb),
      count(*)>p_limit into v_entries,v_more from numbered;
  return jsonb_build_object('entries',v_entries,'has_more',v_more);
end $$;

create or replace function public.runner_personal_best(p_mode smallint,p_speed_mode text default 'normal')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_mode is null or p_mode<>1 or p_speed_mode is null or p_speed_mode not in ('normal','fast') then raise exception 'Invalid mode' using errcode='22023'; end if;
  select jsonb_build_object('nickname',p.nickname,'player_code',p.player_code,'distance',r.distance,
    'rank',case when r.distance is null then null else 1+(select count(*) from public.runner_records s where s.mode=p_mode and s.speed_mode=p_speed_mode and s.distance>r.distance) end)
    into v_result from public.runner_players p left join public.runner_records r on r.user_id=p.user_id and r.mode=p_mode and r.speed_mode=p_speed_mode where p.user_id=auth.uid();
  return v_result;
end $$;

revoke all on function public.set_runner_name(text),public.submit_runner_score(smallint,bigint,text),
  public.runner_leaderboard(smallint,integer,integer,text),public.runner_personal_best(smallint,text) from public,anon,authenticated;
grant execute on function public.runner_leaderboard(smallint,integer,integer,text) to anon,authenticated;
grant execute on function public.set_runner_name(text),public.submit_runner_score(smallint,bigint,text),
  public.runner_personal_best(smallint,text) to authenticated;
create or replace function public.runner_leaderboard_capabilities()
returns jsonb language sql stable as $$
  select '{"speedModes":["normal","fast"],"oneLifeOnly":true}'::jsonb
$$;
revoke all on function public.runner_leaderboard_capabilities() from public;
grant execute on function public.runner_leaderboard_capabilities() to anon,authenticated;
commit;
