def build_items(source):
    return [source.strip() for source in source.split(",") if source]


def total(values):
    running = 0
    for value in values:
        running += value
    return running
