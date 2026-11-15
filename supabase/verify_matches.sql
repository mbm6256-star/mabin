-- Read-only. Run manually in Supabase SQL Editor as the table owner.
-- Expected: five rows; total_matches=5, total_sets=10; all_checks_pass=true.
-- Totals cover only the five sample matches, not unrelated database records.
-- Scores and set wins are normalized to the sample's A/B orientation.
WITH expected (
    sample_id, played_at, player_a_id, player_b_id, winner_id, sets
) AS (
    VALUES
        ('m1', DATE '2026-11-02', 'p1', 'p2', 'p2', '[[4,6],[3,6]]'::jsonb),
        ('m2', DATE '2026-11-05', 'p1', 'p3', 'p1', '[[6,3],[6,4]]'::jsonb),
        ('m3', DATE '2026-11-07', 'p3', 'p2', 'p3', '[[6,3],[6,4]]'::jsonb),
        ('m4', DATE '2026-11-09', 'p3', 'p1', 'p3', '[[6,3],[6,4]]'::jsonb),
        ('m5', DATE '2026-11-12', 'p1', 'p2', 'p1', '[[6,4],[6,3]]'::jsonb)
), results AS (
    SELECT
        e.sample_id, m.id AS match_id, e.played_at,
        e.player_a_id AS sample_player_a_id,
        e.player_b_id AS sample_player_b_id,
        m.player_a_id AS stored_player_a_id,
        m.player_b_id AS stored_player_b_id,
        e.winner_id AS expected_winner_id, m.winner_id,
        s.set_count, s.stored_sets, s.a_sets_won, s.b_sets_won,
        (m.id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.players WHERE id = m.player_a_id)
         AND EXISTS (SELECT 1 FROM public.players WHERE id = m.player_b_id)
         AND EXISTS (SELECT 1 FROM public.players WHERE id = m.winner_id)
        ) AS player_ids_valid,
        coalesce(s.stored_sets = e.sets AND s.set_numbers = ARRAY[1, 2], false)
            AS scores_match_sample,
        coalesce(m.winner_id = e.winner_id AND (
            (m.winner_id = e.player_a_id AND s.a_sets_won = 2 AND s.b_sets_won = 0)
            OR
            (m.winner_id = e.player_b_id AND s.b_sets_won = 2 AND s.a_sets_won = 0)
        ), false) AS winner_matches_sets
    FROM expected AS e
    LEFT JOIN public.matches AS m
      ON m.played_at = e.played_at
     AND ((m.player_a_id = e.player_a_id AND m.player_b_id = e.player_b_id)
       OR (m.player_a_id = e.player_b_id AND m.player_b_id = e.player_a_id))
    LEFT JOIN LATERAL (
        SELECT
            count(*) AS set_count,
            array_agg(ms.set_number ORDER BY ms.set_number) AS set_numbers,
            jsonb_agg(jsonb_build_array(normalized.a_games, normalized.b_games)
                      ORDER BY ms.set_number) AS stored_sets,
            count(*) FILTER (WHERE normalized.a_games > normalized.b_games) AS a_sets_won,
            count(*) FILTER (WHERE normalized.b_games > normalized.a_games) AS b_sets_won
        FROM public.match_sets AS ms
        CROSS JOIN LATERAL (
            SELECT
                CASE WHEN m.player_a_id = e.player_a_id
                     THEN ms.player_a_games ELSE ms.player_b_games END AS a_games,
                CASE WHEN m.player_a_id = e.player_a_id
                     THEN ms.player_b_games ELSE ms.player_a_games END AS b_games
        ) AS normalized
        WHERE ms.match_id = m.id
    ) AS s ON true
)
SELECT *,
    count(match_id) OVER () AS total_matches,
    sum(set_count) OVER () AS total_sets,
    (count(match_id) OVER () = 5
     AND count(*) OVER () = 5
     AND sum(set_count) OVER () = 10
     AND bool_and(player_ids_valid AND scores_match_sample AND winner_matches_sets)
         OVER ()
    ) AS all_checks_pass
FROM results
ORDER BY sample_id, match_id;
