"""Unit tests for strategy selection heuristic."""


from src.planner.strategies import (
    STRATEGY_DIRECT,
    STRATEGY_ITERATIVE,
    STRATEGY_MANAGER_WORKER,
    STRATEGY_PLAN_THEN_EXECUTE,
    select_strategy,
)


class TestProjectMode:
    def test_always_plan_then_execute(self) -> None:
        strategy, reason = select_strategy("do something", "project")

        assert strategy == STRATEGY_PLAN_THEN_EXECUTE
        assert reason

    def test_long_objective_still_plan_then_execute(self) -> None:
        objective = "A" * 300
        strategy, _ = select_strategy(objective, "project")

        assert strategy == STRATEGY_PLAN_THEN_EXECUTE


class TestWorkflowModeDirect:
    def test_short_simple_objective(self) -> None:
        strategy, reason = select_strategy("send a message", "workflow")

        assert strategy == STRATEGY_DIRECT
        assert reason

    def test_exactly_one_word_below_threshold(self) -> None:
        objective = "x " * 5  # short + no complex keywords
        strategy, _ = select_strategy(objective.strip(), "workflow")

        assert strategy == STRATEGY_DIRECT


class TestWorkflowModeIterative:
    def test_complex_keyword_triggers_iterative(self) -> None:
        strategy, _ = select_strategy("generate a quarterly report", "workflow")

        assert strategy == STRATEGY_ITERATIVE

    def test_long_objective_triggers_iterative(self) -> None:
        objective = "do something " * 12  # > 120 chars, no keywords
        strategy, _ = select_strategy(objective.strip(), "workflow")

        assert strategy == STRATEGY_ITERATIVE

    def test_multiple_complex_keywords(self) -> None:
        strategy, _ = select_strategy("deploy and migrate the database", "workflow")

        assert strategy == STRATEGY_ITERATIVE


class TestWorkflowModeManagerWorker:
    def test_long_objective_with_many_complex_keywords_escalates(self) -> None:
        # >= 40 words, >= 3 distinct complex keywords.
        objective = (
            "coordinate and orchestrate the quarterly initiative to research "
            "compare and compile findings from every regional team then generate "
            "a report summarizing and synthesizing all results before we schedule "
            "the review and deploy the final plan across every workspace we manage"
        )
        assert len(objective.split()) >= 40

        strategy, reason = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_MANAGER_WORKER
        assert reason

    def test_long_objective_with_too_few_keywords_stays_iterative(self) -> None:
        # Long enough, but only one complex keyword -- below the keyword threshold.
        objective = "please " * 39 + "report"
        assert len(objective.split()) >= 40

        strategy, _ = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_ITERATIVE

    def test_many_keywords_but_short_objective_stays_iterative(self) -> None:
        # Below the word-count threshold even with several complex keywords.
        objective = "deploy migrate generate compile compare review"
        assert len(objective.split()) < 40

        strategy, _ = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_ITERATIVE

    def test_project_mode_never_escalates_to_manager_worker(self) -> None:
        objective = (
            "coordinate and orchestrate the quarterly initiative to research "
            "compare and compile findings from every regional team then generate "
            "a report summarizing and synthesizing all results before we schedule "
            "the review and deploy the final plan across every workspace we manage"
        )

        strategy, _ = select_strategy(objective, "project")

        assert strategy == STRATEGY_PLAN_THEN_EXECUTE


class TestUnknownMode:
    def test_unknown_mode_defaults_to_iterative(self) -> None:
        strategy, reason = select_strategy("do something", "unknown_mode")

        assert strategy == STRATEGY_ITERATIVE
        assert "unknown_mode" in reason

    def test_empty_string_mode(self) -> None:
        strategy, _ = select_strategy("do something", "")

        assert strategy == STRATEGY_ITERATIVE


class TestStrategySelectionTracksSurfaceFormNotActualScope:
    """Batch 5 probe (rebuild plan, "Planner 40-word threshold").

    select_strategy's own docstring says this "never calls the LLM" -- it is
    word count plus membership in a fixed 23-word set, nothing else. These
    tests are written to fail if that diagnosis is wrong: a semantically
    trivial objective padded past the thresholds should escalate, and a
    genuinely multi-team, multi-region objective phrased concisely should
    not, even though the second is the harder problem by any real measure.
    """

    def test_trivial_lookup_padded_past_both_thresholds_escalates(self) -> None:
        # The actual task is "look up one fact." Padding with filler words
        # and a handful of incidental complex-keyword hits is enough to
        # trigger the fan-out strategy meant for genuinely large,
        # multi-workstream work.
        objective = (
            "please look up the capital city of France and also generate a small "
            "report about it then review it every single time even though this is "
            "really just one simple trivial lookup that anyone could plan to "
            "compile quickly without needing a team to coordinate anything at all today"
        )
        assert len(objective.split()) >= 40

        strategy, reason = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_MANAGER_WORKER
        assert reason

    def test_genuinely_multi_team_objective_stated_concisely_does_not_escalate(self) -> None:
        # The actual task -- a zero-downtime, multi-region regulatory
        # migration synchronized across three engineering teams -- is a
        # textbook case for the parallel manager/worker strategy. Phrased in
        # 28 words with none of the fixed keywords, it is classified as
        # ITERATIVE: a single execution path, not a fan-out. The heuristic
        # never sees "three teams," "twelve countries," or "zero downtime"
        # as complexity signals -- only word count and set membership.
        objective = (
            "Restructure our multi-region payment infrastructure to comply with new "
            "regulations across twelve countries while keeping zero downtime and "
            "syncing three separate engineering teams on a shared cutover window"
        )
        assert len(objective.split()) < 40

        strategy, _ = select_strategy(objective, "workflow")

        assert strategy != STRATEGY_MANAGER_WORKER
        assert strategy == STRATEGY_ITERATIVE
