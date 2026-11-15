#include <stdio.h>

void report(const char *name) {
    printf("%s\n", name);
}

int main(void) {
    report("hello");
    return 0;
}
