def place(board, x, y):
    if x < 0 or y < 0:
        return None
    if x > 2 or y > 2:
        return None
    board[y][x] = 1
    return board


def score(rows):
    total = 0
    for row in rows:
        for cell in row:
            if cell > 0 and cell < 9:
                total += cell
            elif cell >= 9:
                total -= 1
    return total


def alpha(xs):
    ys = [x for x in xs if x % 2]
    zs = [y + 1 for y in ys]
    out = sum(zs)
    return out


def beta(items):
    kept = [i for i in items if i % 3]
    mapped = [k - 1 for k in kept]
    res = sum(mapped)
    return res


def invoice(order):
    lines = [l for l in order.lines if l.qty > 0]
    subtotal = sum(l.qty * l.price for l in lines)
    tax = subtotal * order.rate
    total = subtotal + tax
    return {"lines": lines, "total": total}


def receipt(sale):
    items = [i for i in sale.items if i.count > 0]
    amount = sum(i.count * i.cost for i in items)
    duty = amount * sale.levy
    grand = amount + duty
    return {"items": items, "grand": grand}
