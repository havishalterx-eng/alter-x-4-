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
    def test_enumerated_workstreams_escalate(self) -> None:
        # Four enumerated workstreams, past the length floor.
        objective = (
            "Run a cross-region disaster recovery exercise with database, "
            "platform, support, and documentation workstreams"
        )

        strategy, reason = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_MANAGER_WORKER
        assert reason

    def test_long_objective_without_enumeration_stays_iterative(self) -> None:
        # Long, but one workstream. Length alone must not fan out -- this is
        # what the old 40-word threshold got wrong in the other direction,
        # escalating anything verbose enough.
        objective = "please " * 39 + "report"
        assert len(objective.split()) >= 40

        strategy, _ = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_ITERATIVE

    def test_short_enumeration_does_not_escalate(self) -> None:
        # Four items, but trivial ones: fanning out to parallel agents costs
        # more than doing the work, which is what the length floor is for.
        # It falls through to the ordinary direct/iterative split, and this
        # one is short with no complex keyword, so: direct.
        objective = "fix a, b, c, and d"
        assert objective.count(",") + 1 >= 4

        strategy, _ = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_DIRECT

    def test_few_enumerated_items_stays_iterative(self) -> None:
        objective = (
            "Migrate the reporting database and then deploy the replacement "
            "service, once the maintenance window has been agreed with support"
        )
        assert objective.count(",") + 1 < 4

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

    select_strategy's own docstring says this "never calls the LLM" -- it
    reads the objective's surface form, nothing else. These tests are written
    to fail if that diagnosis stops being true.

    Half of what they documented has been fixed: padding a trivial objective
    past a word count no longer escalates it, because the rule now counts
    enumerated workstreams rather than words. The other half has not, and the
    second test still passes for the original reason -- a concisely stated,
    genuinely parallel objective is still classified as a single execution
    path. Counting commas is a better proxy for scope than counting words; it
    is still a proxy.
    """

    def test_trivial_lookup_padded_out_no_longer_escalates(self) -> None:
        # The actual task is "look up one fact". Under the old 40-word /
        # 3-keyword rule, padding it with filler and incidental keyword hits
        # was enough to trigger the fan-out strategy meant for genuinely
        # large, multi-workstream work. It enumerates nothing, so it no
        # longer does.
        objective = (
            "please look up the capital city of France and also generate a small "
            "report about it then review it every single time even though this is "
            "really just one simple trivial lookup that anyone could plan to "
            "compile quickly without needing a team to coordinate anything at all today"
        )
        assert len(objective.split()) >= 40

        strategy, reason = select_strategy(objective, "workflow")

        assert strategy == STRATEGY_ITERATIVE
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
