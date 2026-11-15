-- Apply manually in Supabase SQL Editor. Does not insert test data, alter tables,
-- update existing records, or change RLS. New function is service_role-only.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_tennis_match(
    p_player_a_id text,
    p_player_b_id text,
    p_played_at date,
    p_sets jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $$
DECLARE
    v_pair jsonb;
    v_a integer;
    v_b integer;
    v_a_wins integer := 0;
    v_b_wins integer := 0;
    v_winner text;
    v_normal_sets jsonb;
    v_signature jsonb;
    v_existing_ids bigint[];
    v_match public.matches%ROWTYPE;
    v_created boolean := false;
    v_stored_sets jsonb;
BEGIN
    IF p_player_a_id IS NULL OR btrim(p_player_a_id) = ''
       OR p_player_b_id IS NULL OR btrim(p_player_b_id) = ''
       OR p_player_a_id = p_player_b_id
       OR p_played_at IS NULL OR NOT isfinite(p_played_at)
       OR p_played_at < DATE '0001-01-01' OR p_played_at > DATE '9999-12-31'
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid players or date';
    END IF;

    IF p_sets IS NULL OR jsonb_typeof(p_sets) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Sets must be an array';
    END IF;
    IF jsonb_array_length(p_sets) NOT BETWEEN 2 AND 3 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Two or three completed sets required';
    END IF;
    FOR v_pair IN SELECT value FROM jsonb_array_elements(p_sets) LOOP
        IF jsonb_typeof(v_pair) <> 'array' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid set';
        END IF;
        IF jsonb_array_length(v_pair) <> 2
           OR jsonb_typeof(v_pair -> 0) IS DISTINCT FROM 'number'
           OR jsonb_typeof(v_pair -> 1) IS DISTINCT FROM 'number'
           OR (v_pair ->> 0) !~ '^[0-7]$' OR (v_pair ->> 1) !~ '^[0-7]$'
        THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Integer game scores required';
        END IF;
        v_a := (v_pair ->> 0)::integer;
        v_b := (v_pair ->> 1)::integer;
        IF v_a_wins = 2 OR v_b_wins = 2
           OR NOT ((greatest(v_a,v_b) = 6 AND least(v_a,v_b) <= 4)
                OR (greatest(v_a,v_b) = 7 AND least(v_a,v_b) IN (5,6)))
        THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid tennis set or extra set after match end';
        END IF;
        IF v_a > v_b THEN v_a_wins := v_a_wins + 1;
        ELSE v_b_wins := v_b_wins + 1;
        END IF;
    END LOOP;
    IF v_a_wins <> 2 AND v_b_wins <> 2 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Match is not complete';
    END IF;
    v_winner := CASE WHEN v_a_wins = 2 THEN p_player_a_id ELSE p_player_b_id END;

    -- Lock referenced players against deletion until this transaction completes.
    PERFORM id FROM public.players
    WHERE id IN (p_player_a_id,p_player_b_id) ORDER BY id FOR KEY SHARE;
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player_a_id)
       OR NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player_b_id)
    THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Player does not exist';
    END IF;

    SELECT jsonb_agg(
        CASE WHEN p_player_a_id COLLATE "C" < p_player_b_id COLLATE "C"
             THEN e.score ELSE jsonb_build_array(e.score -> 1,e.score -> 0) END
        ORDER BY e.n
    ) INTO v_normal_sets
    FROM jsonb_array_elements(p_sets) WITH ORDINALITY AS e(score,n);
    v_signature := jsonb_build_array(
        p_played_at,
        least(p_player_a_id COLLATE "C",p_player_b_id COLLATE "C"),
        greatest(p_player_a_id COLLATE "C",p_player_b_id COLLATE "C"),
        v_normal_sets
    );
    -- Serializes identical requests across tabs, processes, retries and A/B swaps.
    -- The following SELECT obtains a fresh snapshot under READ COMMITTED.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_signature::text,0));

    SELECT array_agg(m.id ORDER BY m.id) INTO v_existing_ids
    FROM public.matches AS m
    WHERE m.played_at = p_played_at
      AND ((m.player_a_id = p_player_a_id AND m.player_b_id = p_player_b_id)
        OR (m.player_a_id = p_player_b_id AND m.player_b_id = p_player_a_id))
      AND (SELECT jsonb_agg(
               CASE WHEN m.player_a_id = p_player_a_id
                    THEN jsonb_build_array(s.player_a_games,s.player_b_games)
                    ELSE jsonb_build_array(s.player_b_games,s.player_a_games) END
               ORDER BY s.set_number
           ) FROM public.match_sets AS s WHERE s.match_id = m.id) = p_sets
      AND (SELECT array_agg(s.set_number ORDER BY s.set_number)
           FROM public.match_sets AS s WHERE s.match_id = m.id)
          = CASE WHEN jsonb_array_length(p_sets) = 2 THEN ARRAY[1,2] ELSE ARRAY[1,2,3] END;

    IF coalesce(cardinality(v_existing_ids),0) > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Multiple identical matches already exist';
    END IF;
    IF coalesce(cardinality(v_existing_ids),0) = 1 THEN
        SELECT * INTO STRICT v_match FROM public.matches WHERE id = v_existing_ids[1];
        IF v_match.winner_id <> v_winner THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Stored winner conflicts with scores';
        END IF;
    ELSE
        INSERT INTO public.matches(player_a_id,player_b_id,winner_id,played_at)
        VALUES(p_player_a_id,p_player_b_id,v_winner,p_played_at)
        RETURNING * INTO v_match;

        INSERT INTO public.match_sets(match_id,set_number,player_a_games,player_b_games)
        SELECT v_match.id,e.n::integer,(e.score ->> 0)::integer,(e.score ->> 1)::integer
        FROM jsonb_array_elements(p_sets) WITH ORDINALITY AS e(score,n);
        v_created := true;
    END IF;

    SELECT jsonb_agg(jsonb_build_array(s.player_a_games,s.player_b_games) ORDER BY s.set_number)
    INTO v_stored_sets FROM public.match_sets AS s WHERE s.match_id = v_match.id;
    RETURN jsonb_build_object(
        'created',v_created,
        'winner_id',v_match.winner_id,
        'match',jsonb_build_object('id',v_match.id::text,'date',v_match.played_at,
            'a',v_match.player_a_id,'b',v_match.player_b_id,'sets',v_stored_sets)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_tennis_match(text,text,date,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_tennis_match(text,text,date,jsonb) TO service_role;

COMMIT;
