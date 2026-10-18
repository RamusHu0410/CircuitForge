from app.core.wire_router import BLOCKED, WireRouter, edges_to_wires


def router(width: int = 12, height: int = 8) -> WireRouter:
    return WireRouter((0, 0, width - 1, height - 1))


def test_straight_path_is_preferred() -> None:
    path = router().find_path("A", (0, 3), {(8, 3)})
    assert path == [(i, 3) for i in range(9)]


def test_routes_around_other_nets_and_obstacles() -> None:
    r = router()
    for j in range(0, 7):
        r.owner[(4, j)] = "B"  # a wall of another net with a gap at the bottom
    r.block((4, 7)) if False else None
    path = r.find_path("A", (0, 3), {(8, 3)})
    assert path is not None and all(r.can_use(c, "A") for c in path)
    assert any(c[1] == 7 for c in path)  # went through the gap
    assert (4, 3) not in path


def test_never_crosses_a_complete_wall() -> None:
    r = router()
    for j in range(8):
        r.owner[(4, j)] = "B"
    assert r.find_path("A", (0, 3), {(8, 3)}) is None


def test_may_reuse_cells_of_its_own_net() -> None:
    r = router()
    for j in range(8):
        r.owner[(4, j)] = "A"
    assert r.find_path("A", (0, 3), {(8, 3)}) is not None


def test_blocked_cells_are_obstacles() -> None:
    r = router()
    r.block((3, 3))
    path = r.find_path("A", (0, 3), {(8, 3)})
    assert (3, 3) not in path
    assert r.owner[(3, 3)] == BLOCKED


def test_fewer_turns_win_over_equal_length() -> None:
    path = router().find_path("A", (0, 0), {(5, 5)})
    turns = sum(1 for a, b, c in zip(path, path[1:], path[2:]) if (b[0] - a[0], b[1] - a[1]) != (c[0] - b[0], c[1] - b[1]))
    assert turns == 1


def test_wires_never_pass_through_pin_end_points() -> None:
    """Regression: a path used to run through its own pin cell and double back, leaving a dead-end wire."""
    r = router()
    r.no_pass = {(4, 3)}
    r.owner[(4, 3)] = "A"
    path = r.find_path("A", (0, 3), {(8, 3)})
    assert path is not None and (4, 3) not in path
    # Even when the only way through is the pin cell itself.
    for j in (0, 1, 2, 4, 5, 6, 7):
        r.owner[(4, j)] = "B"
    assert r.find_path("A", (0, 3), {(8, 3)}) is None


def test_claim_respects_bounds_and_ownership() -> None:
    r = router()
    assert r.claim((1, 1), "A") and r.claim((1, 1), "A")
    assert not r.claim((1, 1), "B")
    assert not r.claim((99, 99), "A")


def test_edges_merge_into_straight_wires_with_junctions() -> None:
    # A tee: horizontal run (0,0)-(4,0) plus a branch down from (2,0) to (2,2).
    edges = set()
    for i in range(4):
        edges.add(((i, 0), (i + 1, 0)))
    edges |= {((2, 0), (2, 1)), ((2, 1), (2, 2))}

    segments, junctions, nodes = edges_to_wires(edges, terminals={(0, 0), (4, 0), (2, 2)})

    assert sorted(tuple(sorted(s)) for s in segments) == [((0, 0), (2, 0)), ((2, 0), (2, 2)), ((2, 0), (4, 0))]
    assert junctions == {(2, 0)}
    assert (2, 0) in nodes  # wires end on the tee instead of touching the middle of another wire


def test_corner_splits_wires() -> None:
    edges = {((0, 0), (1, 0)), ((1, 0), (1, 1)), ((1, 1), (1, 2))}
    segments, junctions, _ = edges_to_wires(edges, terminals={(0, 0), (1, 2)})
    assert sorted(tuple(sorted(s)) for s in segments) == [((0, 0), (1, 0)), ((1, 0), (1, 2))]
    assert junctions == set()


def _wall(r: WireRouter, net: str = "B", x: int = 4, height: int = 8) -> None:
    """A straight vertical wire of `net` through the whole grid at column x."""
    cells = [(x, j) for j in range(height)]
    r.commit_path(net, cells)


def test_crossable_nets_cross_straight_through() -> None:
    r = WireRouter((0, 0, 11, 7), crossable={"A", "B"})
    _wall(r)
    path = r.find_path("A", (0, 3), {(8, 3)})
    assert path == [(i, 3) for i in range(9)]  # straight across the wall
    r.commit_path("A", path)
    assert r.crossings == {(4, 3)} and r.owner[(4, 3)] == "B"
    # Neither net may now turn, join or end on the crossing.
    assert not r.can_use((4, 3), "A") and not r.can_use((4, 3), "B")
    a_segments, a_junctions, _ = edges_to_wires(r.edges["A"], {(0, 3), (8, 3)})
    assert a_segments == [((0, 3), (8, 3))] and not a_junctions  # one wire, no junction at the crossing


def test_nets_that_are_not_crossable_still_never_cross() -> None:
    r = WireRouter((0, 0, 11, 7), crossable={"A"})  # B is not crossable
    _wall(r)
    assert r.find_path("A", (0, 3), {(8, 3)}) is None


def test_no_crossing_at_a_corner_or_tee_of_the_other_net() -> None:
    r = WireRouter((0, 0, 11, 7), crossable={"A", "B"})
    _wall(r)
    r.commit_path("B", [(4, 3), (5, 3)])  # B now has a tee at (4, 3)
    path = r.find_path("A", (0, 3), {(8, 3)})
    assert path is not None and (4, 3) not in path
